import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { unzip } from "./unzip.ts";
import type { RepoRef } from "./registry.ts";
import {
  cacheDir,
  installsPath,
  marketError,
  marketHome,
  safeEntryPath,
  skillsRoot,
  trashDir,
  validSkillName,
} from "./paths.ts";

const ARCHIVE_LIMIT = 32 << 20;

export interface InstallRecord {
  name: string;
  repo: RepoRef;
  commitHash: string;
  /** 安装时 GitHub ref 的 commit SHA（用于跟踪上游更新，空表示未获取） */
  commitSha: string;
  installedAt: string;
  files: { path: string; hash: string }[];
}

interface StoreFile {
  version: 1;
  installs: InstallRecord[];
}

// ---------- 登记表（installs.json 原子读写） ----------

export async function readStore(): Promise<StoreFile> {
  try {
    const info = await fs.lstat(installsPath());
    if (info.isSymbolicLink() || !info.isFile() || info.size > 16 << 20) {
      throw marketError("安装登记文件不安全", "error.market.state");
    }
    const value = JSON.parse(await fs.readFile(installsPath(), "utf8"));
    if (!value || value.version !== 1 || !Array.isArray(value.installs)) {
      throw marketError("安装登记格式无效", "error.market.state");
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, installs: [] };
    }
    throw error;
  }
}

export async function writeStore(value: StoreFile): Promise<void> {
  const text = JSON.stringify(value, null, 2);
  await fs.mkdir(marketHome(), { recursive: true });
  const temporary = `${installsPath()}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, text, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, installsPath());
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

// ---------- 简化 SKILL.md frontmatter 解析 ----------

export interface SkillDoc {
  name: string;
  description: string;
  hasFrontmatter: boolean;
  body: string;
}

export function parseSkillDoc(raw: string): SkillDoc {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { name: "", description: "", hasFrontmatter: false, body: normalized };
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) {
    return { name: "", description: "", hasFrontmatter: false, body: normalized };
  }
  const head = normalized.slice(4, end);
  const body = normalized.slice(end + 5);
  const map: Record<string, string> = {};
  for (const line of head.split("\n")) {
    const matched = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim());
    if (!matched) continue;
    const value = matched[2].trim().replace(/^["']|["']$/g, "");
    map[matched[1].toLowerCase()] = value;
  }
  return {
    name: map.name ?? "",
    description: map.description ?? "",
    hasFrontmatter: true,
    body,
  };
}

// ---------- 归档下载 / 解包 / 扫描 ----------

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export interface Archive {
  entries: Record<string, Uint8Array>;
  hash: string;
}

async function requestArchive(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
    headers: { Accept: "application/zip", "User-Agent": "dsh-skill-market" },
  });
  if (!response.ok) {
    throw marketError(
      `技能包下载失败（HTTP ${response.status}），请稍后重试`,
      "error.market.network",
    );
  }
  const declared = Number(response.headers.get("content-length"));
  if (declared > ARCHIVE_LIMIT) {
    throw marketError("技能包超过 32 MiB 限制", "error.market.tooLarge");
  }
  const reader = response.body?.getReader();
  if (!reader) throw marketError("下载响应为空", "error.market.network");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > ARCHIVE_LIMIT) {
      throw marketError("技能包超过 32 MiB 限制", "error.market.tooLarge");
    }
    chunks.push(value);
  }
  await reader.cancel();
  return Buffer.concat(chunks, length);
}

/** 解包 GitHub zip：剥离单一顶层目录，逐条路径安全校验 */
export function decodeArchive(bytes: Buffer): Record<string, Uint8Array> {
  const archive = unzip(new Uint8Array(bytes));
  const seen = new Set<string>();
  let total = 0;
  const result: Record<string, Uint8Array> = Object.create(null);
  let root: string | undefined;
  for (const [path, data] of Object.entries(archive)) {
    safeEntryPath(path);
    const key = path.toLowerCase();
    if (seen.has(key)) throw marketError("技能包内存在重复路径", "error.market.badPackage");
    seen.add(key);
    total += data.byteLength;
    if (total > 64 << 20) throw marketError("技能包解压后过大", "error.market.tooLarge");
    const slash = path.indexOf("/");
    if (slash < 1) throw marketError("技能包归档结构无效", "error.market.badPackage");
    const prefix = path.slice(0, slash);
    if (root && root !== prefix) {
      throw marketError("技能包归档根目录不唯一", "error.market.badPackage");
    }
    root = prefix;
    result[safeEntryPath(path.slice(slash + 1))] = data;
  }
  return result;
}

/** 下载（带磁盘缓存）并解包一个 GitHub 仓库归档 */
export async function fetchArchive(repo: RepoRef): Promise<Archive> {
  const refPart = repo.ref ? repo.ref : "HEAD";
  const url = `https://codeload.github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/zip/${encodeURIComponent(refPart)}`;
  const dir = cacheDir();
  await fs.mkdir(dir, { recursive: true });
  const cachedPath = cachedArchivePath(repo.owner, repo.name, refPart);
  try {
    const info = await fs.lstat(cachedPath);
    if (info.isFile() && !info.isSymbolicLink() && info.size <= ARCHIVE_LIMIT) {
      const bytes = await fs.readFile(cachedPath);
      return { entries: decodeArchive(bytes), hash: sha256(bytes) };
    }
  } catch {
    // 缓存未命中，走下载
  }
  const bytes = await requestArchive(url);
  const hash = sha256(bytes);
  const tmp = join(dir, `${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, bytes, { flag: "wx" });
    await fs.rename(tmp, cachedPath);
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
  return { entries: decodeArchive(bytes), hash };
}

/** 扫描归档内全部 SKILL.md，产出可浏览的技能清单 */
export interface ScannedSkill {
  path: string;
  name: string;
  description: string;
  hasFrontmatter: boolean;
  fileCount: number;
}

export function scanArchiveSkills(entries: Record<string, Uint8Array>): ScannedSkill[] {
  const skills: ScannedSkill[] = [];
  for (const [path, data] of Object.entries(entries)) {
    if (path !== "SKILL.md" && !path.endsWith("/SKILL.md")) continue;
    if (data.byteLength > 256 << 10) continue;
    const directory = path === "SKILL.md" ? "" : path.slice(0, -"SKILL.md".length);
    const doc = parseSkillDoc(Buffer.from(data).toString("utf8"));
    const prefix = directory ? directory.length + 1 : 0;
    const fileCount = Object.keys(entries).filter((p) =>
      directory ? p.startsWith(`${directory}/`) : true,
    ).length - (prefix ? 0 : 0);
    skills.push({
      path: directory,
      name: doc.name || directory.split("/").filter(Boolean).pop() || "",
      description: doc.description,
      hasFrontmatter: doc.hasFrontmatter,
      fileCount,
    });
    if (skills.length >= 500) break;
  }
  return skills;
}

// ---------- GitHub ref SHA（更新跟踪） ----------

/** 获取 GitHub ref 当前 commit SHA；失败返回 null（不阻断安装） */
export async function getRefSha(owner: string, name: string, ref: string): Promise<string | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(ref)}`, {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: "application/vnd.github+json", "User-Agent": "dsh-skill-market" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { sha?: unknown };
    return typeof body.sha === "string" ? body.sha : null;
  } catch {
    return null;
  }
}

/** 计算仓库归档缓存路径（更新时需要强制失效） */
function cachedArchivePath(owner: string, name: string, ref: string): string {
  return join(cacheDir(), `${owner}--${name}--${sha256(Buffer.from(ref)).slice(0, 24)}.zip`);
}

// ---------- 安装 / 卸载 / 已装列表 / 回收站 ----------

async function writeSkillFiles(
  targetDir: string,
  entries: Record<string, Uint8Array>,
  prefix: string,
): Promise<{ path: string; hash: string }[]> {
  const files: { path: string; hash: string }[] = [];
  for (const [path, data] of Object.entries(entries)) {
    if (prefix && !path.startsWith(`${prefix}/`)) continue;
    const relative = prefix ? path.slice(prefix.length + 1) : path;
    if (!relative) continue;
    const dest = join(targetDir, ...relative.split("/"));
    await fs.mkdir(join(dest, ".."), { recursive: true });
    await fs.writeFile(dest, data, { flag: "wx" });
    files.push({ path: relative, hash: sha256(data) });
  }
  return files;
}

/**
 * 安装一个技能：拉归档 → 定位子目录 → 校验 SKILL.md → 同名冲突检查 → 写入 → 登记。
 * 冲突时不覆盖本地文件，要求先卸载。
 */
export async function installSkill(input: {
  owner: string;
  name: string;
  ref?: string;
  path?: string;
}): Promise<{ name: string; dir: string; fileCount: number }> {
  const repo: RepoRef = {
    owner: String(input.owner || ""),
    name: String(input.name || ""),
    ref: String(input.ref || "main"),
    path: String(input.path || "").replace(/^\/+|\/+$/g, ""),
  };
  if (!/^[a-z0-9][a-z0-9-]{0,38}$/i.test(repo.owner) || !repo.name) {
    throw marketError("仓库地址无效", "error.market.badRepo");
  }
  const { entries, hash } = await fetchArchive(repo);
  const prefix = repo.path;
  const docPath = prefix ? `${prefix}/SKILL.md` : "SKILL.md";
  const docBytes = entries[docPath];
  if (!docBytes) {
    throw marketError("该目录下没有 SKILL.md，不是有效技能包", "error.market.notSkill");
  }
  const doc = parseSkillDoc(Buffer.from(docBytes).toString("utf8"));
  const dirName = (doc.name || prefix.split("/").filter(Boolean).pop() || "").toLowerCase();
  if (!validSkillName(dirName)) {
    throw marketError(
      `技能名无效（${dirName || "空"}）：需为 kebab-case 且非保留名`,
      "error.market.badName",
    );
  }
  const root = skillsRoot();
  const targetDir = join(root, dirName);
  try {
    await fs.lstat(targetDir);
    throw marketError(
      `本地已存在同名技能 ${dirName}，为保护本地文件不会覆盖；请先卸载或改名`,
      "error.market.conflict",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const store = await readStore();
  if (store.installs.some((r) => r.name === dirName)) {
    throw marketError("登记表中已存在同名安装记录", "error.market.conflict");
  }
  await fs.mkdir(root, { recursive: true });
  let files: { path: string; hash: string }[] = [];
  try {
    files = await writeSkillFiles(targetDir, entries, prefix);
  } catch (error) {
    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  const commitSha = await getRefSha(repo.owner, repo.name, repo.ref);
  store.installs = store.installs.filter((r) => r.name !== dirName);
  store.installs.push({
    name: dirName,
    repo,
    commitHash: hash,
    commitSha: commitSha ?? "",
    installedAt: new Date().toISOString(),
    files,
  });
  await writeStore(store);
  return { name: dirName, dir: targetDir, fileCount: files.length };
}

/** 已装技能（本地扫描 + 登记来源合并 + 启停状态 + 轻量诊断） */
export interface InstalledSkill {
  name: string;
  description: string;
  hasFrontmatter: boolean;
  enabled: boolean;
  fromMarket: boolean;
  /** 诊断问题代码：missing-frontmatter / name-mismatch / missing-description / short-description */
  issues: string[];
  repo?: RepoRef;
  commitSha?: string;
  installedAt?: string;
}

const DOC_BASENAMES = ["SKILL.md", "SKILL.md.disabled"] as const;

/** 解析技能目录的发现文件（启用/禁用两种形态） */
async function resolveDiscoveryPath(
  dir: string,
): Promise<{ docPath: string; enabled: boolean } | null> {
  for (const base of DOC_BASENAMES) {
    try {
      const info = await fs.lstat(join(dir, base));
      if (info.isFile() && !info.isSymbolicLink()) {
        return { docPath: join(dir, base), enabled: base === "SKILL.md" };
      }
    } catch {
      // 尝试下一个形态
    }
  }
  return null;
}

function diagnose(dirName: string, doc: SkillDoc): string[] {
  const issues: string[] = [];
  if (!doc.hasFrontmatter) issues.push("missing-frontmatter");
  if (doc.name && doc.name.toLowerCase() !== dirName.toLowerCase()) issues.push("name-mismatch");
  if (!doc.description) issues.push("missing-description");
  else if (doc.description.length < 10) issues.push("short-description");
  return issues;
}

export async function listInstalled(): Promise<InstalledSkill[]> {
  const root = skillsRoot();
  let names: string[] = [];
  try {
    names = (await fs.readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.isSymbolicLink())
      .map((d) => d.name);
  } catch {
    return [];
  }
  const store = await readStore();
  const byName = new Map(store.installs.map((r) => [r.name, r]));
  const result: InstalledSkill[] = [];
  for (const name of names.sort()) {
    try {
      const dir = join(root, name);
      const discovery = await resolveDiscoveryPath(dir);
      if (!discovery) continue;
      const doc = parseSkillDoc(await fs.readFile(discovery.docPath, "utf8"));
      const record = byName.get(name.toLowerCase());
      result.push({
        name,
        description: doc.description,
        hasFrontmatter: doc.hasFrontmatter,
        enabled: discovery.enabled,
        fromMarket: !!record,
        issues: diagnose(name, doc),
        repo: record?.repo,
        commitSha: record?.commitSha,
        installedAt: record?.installedAt,
      });
    } catch {
      // 读取失败的目录跳过
    }
  }
  return result;
}

// ---------- 启停（禁用只改发现文件名，源文件保留） ----------

export async function toggleSkill(input: { name: string; enabled: boolean }): Promise<{
  name: string;
  enabled: boolean;
}> {
  const name = String(input.name || "");
  const enabled = input.enabled === true;
  if (!validSkillName(name)) throw marketError("技能名无效", "error.market.badName");
  const dir = join(skillsRoot(), name);
  const current = await resolveDiscoveryPath(dir);
  if (!current) throw marketError(`技能 ${name} 不存在`, "error.market.notFound", 404);
  if (current.enabled === enabled) {
    return { name, enabled };
  }
  const from = current.docPath;
  const to = join(dir, enabled ? "SKILL.md" : "SKILL.md.disabled");
  try {
    await fs.rename(from, to);
  } catch (error) {
    throw marketError(
      `切换启停状态失败：${(error as Error).message}`,
      "error.market.toggleFailed",
    );
  }
  return { name, enabled };
}

// ---------- 更新跟踪（源级 commitSha 快照对比） ----------

export interface UpdateStatus {
  name: string;
  updateAvailable: boolean;
  currentSha: string;
  latestSha: string;
  /** 上游查不到 ref 或仓库不可达 */
  checkFailed: boolean;
}

/** 检查全部商店安装的技能是否有上游更新 */
export async function checkUpdates(): Promise<UpdateStatus[]> {
  const store = await readStore();
  const statuses = await Promise.all(
    store.installs.map(async (record): Promise<UpdateStatus> => {
      const latestSha = await getRefSha(record.repo.owner, record.repo.name, record.repo.ref);
      return {
        name: record.name,
        updateAvailable: !!latestSha && !!record.commitSha && latestSha !== record.commitSha,
        currentSha: record.commitSha,
        latestSha: latestSha ?? "",
        checkFailed: latestSha === null,
      };
    }),
  );
  return statuses;
}

/**
 * 更新一个商店安装的技能：拉最新归档 → 覆盖本地目录 → 刷新登记。
 * 上游结构变化（SKILL.md 消失）时明确报"上游已删除"，不动本地文件。
 */
export async function updateSkill(input: { name: string }): Promise<{
  name: string;
  updated: boolean;
  fileCount?: number;
  reason?: string;
}> {
  const name = String(input.name || "");
  if (!validSkillName(name)) throw marketError("技能名无效", "error.market.badName");
  const store = await readStore();
  const record = store.installs.find((r) => r.name === name);
  if (!record) {
    throw marketError(
      `${name} 不是从商店安装的（无来源记录），不能跟踪更新；可卸载后从商店重装`,
      "error.market.notTracked",
    );
  }
  const latestSha = await getRefSha(record.repo.owner, record.repo.name, record.repo.ref);
  if (latestSha === null) {
    return { name, updated: false, reason: "upstream-unreachable" };
  }
  if (latestSha === record.commitSha) {
    return { name, updated: false, reason: "up-to-date" };
  }
  // ref 已前进：强制绕过归档缓存重新下载
  await fs.rm(cachedArchivePath(record.repo.owner, record.repo.name, record.repo.ref), { force: true });
  const { entries, hash } = await fetchArchive(record.repo);
  const prefix = record.repo.path;
  if (!entries[prefix ? `${prefix}/SKILL.md` : "SKILL.md"]) {
    throw marketError(
      `上游已删除该技能（${prefix || "仓库根"} 下没有 SKILL.md）；本地文件未改动，可自行卸载`,
      "error.market.upstreamDeleted",
    );
  }
  const targetDir = join(skillsRoot(), name);
  const discovery = await resolveDiscoveryPath(targetDir);
  const wasEnabled = discovery?.enabled ?? true;
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });
  let files: { path: string; hash: string }[] = [];
  try {
    files = await writeSkillFiles(targetDir, entries, prefix);
  } catch (error) {
    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  if (!wasEnabled) {
    // 更新后保持原有的禁用状态
    await fs.rename(join(targetDir, "SKILL.md"), join(targetDir, "SKILL.md.disabled")).catch(() => {});
  }
  record.commitHash = hash;
  record.commitSha = latestSha;
  record.files = files;
  record.installedAt = new Date().toISOString();
  await writeStore(store);
  return { name, updated: true, fileCount: files.length };
}

/** 卸载：移入商店回收站（不直接删除，可恢复） */
export async function uninstallSkill(input: { name: string }): Promise<{ trashId: string }> {
  const name = String(input.name || "");
  if (!validSkillName(name)) throw marketError("技能名无效", "error.market.badName");
  const root = skillsRoot();
  const source = join(root, name);
  try {
    await fs.lstat(source);
  } catch {
    throw marketError(`技能 ${name} 不存在`, "error.market.notFound", 404);
  }
  const dir = trashDir();
  await fs.mkdir(dir, { recursive: true });
  const trashId = `${Date.now()}-${randomUUID()}`;
  await fs.rename(source, join(dir, trashId));
  await fs.writeFile(
    join(dir, `${trashId}.meta.json`),
    JSON.stringify({ trashId, name, removedAt: new Date().toISOString() }, null, 2),
    { flag: "wx" },
  );
  const store = await readStore();
  store.installs = store.installs.filter((r) => r.name !== name);
  await writeStore(store);
  return { trashId };
}

export interface TrashItem {
  trashId: string;
  name: string;
  removedAt: string;
}

export async function listTrash(): Promise<TrashItem[]> {
  const dir = trashDir();
  let files: string[] = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const items: TrashItem[] = [];
  for (const file of files) {
    if (!file.endsWith(".meta.json")) continue;
    try {
      const meta = JSON.parse(await fs.readFile(join(dir, file), "utf8"));
      if (meta && typeof meta.trashId === "string" && typeof meta.name === "string") {
        items.push({
          trashId: meta.trashId,
          name: meta.name,
          removedAt: meta.removedAt ?? "",
        });
      }
    } catch {
      // 损坏的元数据跳过
    }
  }
  return items.sort((a, b) => b.trashId.localeCompare(a.trashId));
}

export async function restoreTrash(input: { trashId: string }): Promise<{ name: string }> {
  const trashId = String(input.trashId || "");
  if (!/^\d+-[0-9a-f-]{36}$/.test(trashId)) {
    throw marketError("回收站 ID 无效", "error.market.badTrashId");
  }
  const dir = trashDir();
  const metaPath = join(dir, `${trashId}.meta.json`);
  let name: string;
  try {
    const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    name = String(meta.name || "");
  } catch {
    throw marketError("回收站记录不存在或已损坏", "error.market.notFound", 404);
  }
  if (!validSkillName(name)) throw marketError("记录内技能名无效", "error.market.badName");
  const target = join(skillsRoot(), name);
  try {
    await fs.lstat(target);
    throw marketError(`技能目录 ${name} 已存在，无法恢复；请先处理同名目录`, "error.market.conflict");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await fs.mkdir(skillsRoot(), { recursive: true });
  await fs.rename(join(dir, trashId), target);
  await fs.rm(metaPath, { force: true });
  return { name };
}

export async function purgeTrash(input: { trashId: string }): Promise<void> {
  const trashId = String(input.trashId || "");
  if (trashId === "*") {
    const dir = trashDir();
    await fs.rm(dir, { recursive: true, force: true });
    return;
  }
  if (!/^\d+-[0-9a-f-]{36}$/.test(trashId)) {
    throw marketError("回收站 ID 无效", "error.market.badTrashId");
  }
  const dir = trashDir();
  await fs.rm(join(dir, trashId), { recursive: true, force: true });
  await fs.rm(join(dir, `${trashId}.meta.json`), { force: true });
}
