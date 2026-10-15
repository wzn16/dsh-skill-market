import { createHash } from "node:crypto";
import { httpRequest } from "./http.ts";
import type { RepoRef } from "./registry.ts";
import { marketError, safeEntryPath } from "./paths.ts";

/**
 * 按文件拉取技能目录（GitHub API），替代整仓 zip 下载：
 * - 只取目标技能目录的文件（通常几百 KB），安装从 1-2 分钟降到数秒
 * - 用 Git Trees API 一次拿到整棵树（1 次 API 调用/技能，而非逐目录），规避匿名限流
 * - 文件内容走 raw.githubusercontent（不计 API 限流）+ 并发 6 路
 * - 支持 GITHUB_TOKEN 环境变量提升限流额度（5000/h）
 * - 任何失败由调用方回落整仓 zip 路径
 */

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
const MAX_FILES = 200;
const MAX_FILE_BYTES = 2 << 20;
const MAX_TOTAL_BYTES = 32 << 20;
const FETCH_CONCURRENCY = 6;
const HAS_TOKEN = !!(
  process.env.DSH_SKILL_MARKET_TOKEN ||
  process.env.GITHUB_TOKEN ||
  process.env.GH_TOKEN ||
  ""
);

interface TreeEntry {
  path?: unknown;
  type?: unknown;
  size?: unknown;
}

interface PendingFile {
  key: string;
  /** raw.githubusercontent（不计限流，但国内网络常不稳） */
  rawUrl: string;
  /** api.github.com contents（走 API 计限流，但连通性更稳） */
  apiUrl: string;
}

function ghHeaders(): Record<string, string> {
  const token =
    process.env.DSH_SKILL_MARKET_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "dsh-skill-market",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function ghJSON(url: string): Promise<unknown> {
  const response = await httpRequest(url, { headers: ghHeaders(), timeoutMs: 20_000 });
  if (response.status === 403 || response.status === 429) {
    throw marketError("GitHub API 限流（可设置 GITHUB_TOKEN 提升额度）", "error.market.ghApi");
  }
  if (response.status >= 400) {
    throw marketError(`GitHub API 失败（HTTP ${response.status}）`, "error.market.ghApi");
  }
  return JSON.parse(response.body.toString("utf8"));
}

/**
 * 拉取单个文件内容，三级容错：
 * 1) raw.githubusercontent（快，不计限流；国内可能不通）
 * 2) api.github.com contents（Accept: raw；计限流但连通性稳）
 * 3) 全失败抛出，由上层回落整仓 zip
 */
async function fetchFileBytes(file: PendingFile): Promise<Uint8Array> {
  let lastError: unknown = null;
  // 有 token 时 API 优先（稳定、计 5000/h 限流）；无 token 时 raw 优先（不计限流），5s 快速失败回落
  const uaHeaders = { "User-Agent": "dsh-skill-market" };
  const apiAttempt = {
    url: file.apiUrl,
    headers: { ...ghHeaders(), Accept: "application/vnd.github.raw" },
    timeout: 30_000,
  };
  const rawAttempt = { url: file.rawUrl, headers: uaHeaders, timeout: 5_000 };
  const attempts = HAS_TOKEN
    ? [apiAttempt, rawAttempt]
    : [rawAttempt, apiAttempt];
  for (const attempt of attempts) {
    try {
      const response = await httpRequest(attempt.url, {
        headers: attempt.headers,
        timeoutMs: attempt.timeout,
      });
      if (response.status >= 400) {
        lastError = marketError(`文件下载失败（HTTP ${response.status}）`, "error.market.network");
        continue;
      }
      const declared = Number(response.headers["content-length"] ?? 0);
      if (declared > MAX_FILE_BYTES) throw marketError("技能内单文件过大", "error.market.tooLarge");
      const buffer = new Uint8Array(response.body);
      if (buffer.byteLength > MAX_FILE_BYTES) throw marketError("技能内单文件过大", "error.market.tooLarge");
      return buffer;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? marketError("文件下载失败", "error.market.network");
}

/** 限并发 map */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 内容指纹：排序后的 (相对路径 + 内容 sha256) 再哈希，作为更新跟踪的稳定指纹 */
export function filesFingerprint(files: Record<string, Uint8Array>): string {
  const hash = createHash("sha256");
  for (const path of Object.keys(files).sort()) {
    hash.update(path);
    hash.update("\0");
    hash.update(createHash("sha256").update(files[path]).digest());
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * 按文件拉取一个技能目录。repo.path 必须指向技能目录（单技能仓库可为空）。
 * 返回的 entries 键为技能目录内的相对路径（与整仓 zip 路径解码结果同构）。
 */
export interface FetchProgress {
  stage: "listing" | "downloading";
  done: number;
  total: number;
}

export async function fetchSkillFiles(
  repo: RepoRef,
  opts?: { signal?: AbortSignal; onProgress?: (p: FetchProgress) => void },
): Promise<{ entries: Record<string, Uint8Array>; hash: string }> {
  const signal = opts?.signal;
  const onProgress = opts?.onProgress;
  const checkAborted = (): void => {
    if (signal?.aborted) throw marketError("安装已取消", "error.market.cancelled");
  };
  const dir = repo.path.replace(/^\/+|\/+$/g, "");
  // 一次拿整棵树（1 次 API 调用）
  const tree = (await ghJSON(
    `${API}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/git/trees/${encodeURIComponent(
      repo.ref,
    )}?recursive=1`,
  )) as { tree?: TreeEntry[]; truncated?: unknown };
  if (!Array.isArray(tree.tree)) {
    throw marketError("仓库树查询失败", "error.market.ghApi");
  }
  const prefix = dir ? `${dir}/` : "";
  const pending: PendingFile[] = [];
  let total = 0;
  for (const entry of tree.tree) {
    if (entry.type !== "blob") continue;
    const path = typeof entry.path === "string" ? entry.path : "";
    if (!path || (prefix && !path.startsWith(prefix))) continue;
    const key = safeEntryPath(prefix ? path.slice(prefix.length) : path);
    const size = typeof entry.size === "number" ? entry.size : 0;
    if (size > MAX_FILE_BYTES) throw marketError("技能内单文件过大", "error.market.tooLarge");
    total += size;
    if (total > MAX_TOTAL_BYTES) throw marketError("技能体积超限", "error.market.tooLarge");
    if (pending.length >= MAX_FILES) throw marketError("技能文件数超限", "error.market.tooLarge");
    pending.push({
      key,
      rawUrl: `${RAW}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/${encodeURIComponent(
        repo.ref,
      )}/${path.split("/").map(encodeURIComponent).join("/")}`,
      apiUrl: `${API}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/contents/${path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}?ref=${encodeURIComponent(repo.ref)}`,
    });
  }
  onProgress?.({ stage: "downloading", done: 0, total: pending.length });
  const out: Record<string, Uint8Array> = Object.create(null);
  let downloaded = 0;
  await mapLimit(pending, FETCH_CONCURRENCY, async (file) => {
    checkAborted();
    out[file.key] = await fetchFileBytes(file);
    downloaded += 1;
    onProgress?.({ stage: "downloading", done: downloaded, total: pending.length });
  });
  if (!out["SKILL.md"]) {
    throw marketError("该目录下没有 SKILL.md，不是有效技能包", "error.market.notSkill");
  }
  return { entries: out, hash: filesFingerprint(out) };
}
