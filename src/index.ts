import { getRegistry, withLiveStars, type Registry } from "./registry.ts";
import {
  checkUpdates,
  fetchArchive,
  installSkill,
  listInstalled,
  listTrash,
  parseSkillDoc,
  purgeTrash,
  restoreTrash,
  scanArchiveSkills,
  toggleSkill,
  uninstallSkill,
  updateSkill,
} from "./installer.ts";
import { readConfig, writeConfig } from "./config.ts";
import { addSource, listSources, removeSource, BUILTIN_SOURCES } from "./sources.ts";
import { logPath, marketError } from "./paths.ts";

const NAME = "dsh-skill-market";
const PREFIX = "/api/dsh-skill-market";
const MARKER_HEADER = "x-dsh-skill-market";
const MAX_BODY_BYTES = 1 << 20;

/** 插件依赖的宿主服务：只需要 webServer 挂 API 路由 */
export const inject = ["webServer"];

// ---------- 请求安全（校验来源 + 变更请求标记） ----------

function parseAuthority(authority: string): URL | undefined {
  try {
    return new URL(`http://${authority}`);
  } catch {
    return undefined;
  }
}

function canonicalAuthority(authority: string, parsed: URL): string {
  const port = parsed.port !== "" ? parsed.port : new URL(`https://${authority}`).port;
  return port === "" ? parsed.hostname : `${parsed.hostname}:${port}`;
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    (hostname.split(".").length === 4 &&
      hostname.startsWith("127.") &&
      hostname.split(".").every((p) => Number(p) <= 255))
  );
}

function isTrustedAuthority(hostUrl: URL, trustedHosts: string[]): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry);
    if (!entryUrl) return false;
    return canonicalAuthority(entry, entryUrl) === hostUrl.host;
  });
}

function validateRequestOrigin(
  req: { headers: Record<string, unknown> },
  trustedHosts: string[],
): { statusCode: number; error: string } | null {
  const host = typeof req.headers.host === "string" ? req.headers.host : "";
  const hostUrl = parseAuthority(host);
  if (!hostUrl || canonicalAuthority(host, hostUrl) !== host.toLowerCase()) {
    return { statusCode: 403, error: "forbidden host" };
  }
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) {
    return { statusCode: 403, error: "forbidden host" };
  }
  if (req.headers["sec-fetch-site"] === "cross-site") {
    return { statusCode: 403, error: "forbidden host" };
  }
  const origin = req.headers.origin;
  if (typeof origin === "string") {
    try {
      if (new URL(origin).host !== hostUrl.host) {
        return { statusCode: 403, error: "forbidden host" };
      }
    } catch {
      return { statusCode: 403, error: "forbidden host" };
    }
  }
  return null;
}

function validateMutationRequest(
  req: { headers: Record<string, unknown> },
  trustedHosts: string[],
): { statusCode: number; error: string } | null {
  const hostError = validateRequestOrigin(req, trustedHosts);
  if (hostError) return hostError;
  if (req.headers[MARKER_HEADER] !== "1") {
    return { statusCode: 403, error: "forbidden mutation request" };
  }
  const contentType = String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return { statusCode: 415, error: "content-type must be application/json" };
  }
  return null;
}

function readBody(req: { on: Function }, limit = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(marketError("请求体过大", "error.market.bodyTooLarge", 413));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(marketError(`请求体 JSON 无效：${(error as Error).message}`, "error.market.badJson"));
      }
    });
    req.on("error", reject);
  });
}

type Res = {
  writableEnded: boolean;
  destroyed: boolean;
  writeHead: Function;
  end: Function;
  once: Function;
};

function json(res: Res, code: number, payload: unknown): void {
  if (!res || res.writableEnded || res.destroyed) return;
  res.once("error", () => {});
  try {
    const body = JSON.stringify(payload);
    res.writeHead(code, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
    });
    res.end(body);
  } catch {
    // 客户端已断开
  }
}

function run(res: Res, task: () => Promise<unknown>): void {
  Promise.resolve()
    .then(task)
    .then((result) => json(res, 200, { ok: true, data: result }))
    .catch((error) => {
      const e = error as { statusCode?: number; code?: string; message?: string };
      json(res, typeof e?.statusCode === "number" ? e.statusCode : 500, {
        ok: false,
        ...(typeof e?.code === "string" ? { code: e.code } : {}),
        error: String(e?.message ?? e),
      });
    });
}

function trustedHostsOf(ctx: { root?: { webRuntime?: { trustedHosts?: unknown } } }): string[] {
  try {
    const candidate = ctx.root?.webRuntime;
    if (candidate && Array.isArray(candidate.trustedHosts)) {
      return candidate.trustedHosts.filter((h): h is string => typeof h === "string");
    }
  } catch {
    // 保底空列表
  }
  return [];
}

// ---------- 插件入口 ----------

export interface PluginContext {
  effect(callback: () => unknown, label?: string): unknown;
  emit?(event: string, ...args: unknown[]): unknown;
  get?(service: string): unknown;
  root?: { webRuntime?: { trustedHosts?: unknown } };
  webServer: {
    register(options: {
      kind: "prefix";
      path: string;
      handler: (req: unknown, res: Res) => Promise<unknown> | unknown;
    }): unknown;
  };
}

let logQueue: Promise<void> = Promise.resolve();
function log(event: string, detail: unknown): void {
  logQueue = logQueue.then(async () => {
    try {
      const { appendFile, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(logPath()), { recursive: true });
      await appendFile(
        logPath(),
        `${JSON.stringify({ ts: new Date().toISOString(), event, detail })}\n`,
        "utf8",
      );
    } catch {
      // 日志失败静默
    }
  });
}

export async function apply(ctx: PluginContext): Promise<void> {
  let mutationQueue: Promise<unknown> = Promise.resolve();
  const enqueueMutation = <T>(task: () => Promise<T>): Promise<T> => {
    const next = (mutationQueue as Promise<unknown>).then(task, task) as Promise<T>;
    mutationQueue = next.catch(() => undefined);
    return next;
  };

  const afterWrite = () => {
    try {
      ctx.emit?.("commands/change");
    } catch {
      // 宿主不支持时忽略
    }
  };

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: PREFIX,
        handler: async (req, res) => {
          const r = req as {
            url?: string;
            method?: string;
            headers: Record<string, unknown>;
            on: Function;
          };
          const w = res as Parameters<typeof json>[0];
          try {
            const url = new URL(r.url || "/", "http://localhost");
            const path = url.pathname.replace(/\/+$/, "");
            const method = (r.method || "GET").toUpperCase();
            const trusted = trustedHostsOf(ctx);

            const hostError = validateRequestOrigin(r, trusted);
            if (hostError) {
              json(w, hostError.statusCode, { ok: false, error: hostError.error });
              return;
            }

            if (method === "GET" && path === `${PREFIX}/registry`) {
              return run(w, async () => {
                const { registry, source } = await getRegistry();
                const live = await withLiveStars(registry);
                return { registry: live as Registry, source };
              });
            }
            if (method === "GET" && path === `${PREFIX}/browse-repo`) {
              return run(w, async () => {
                const owner = url.searchParams.get("owner") || "";
                const name = url.searchParams.get("name") || "";
                const ref = url.searchParams.get("ref") || "main";
                if (!/^[a-z0-9][a-z0-9-]{0,38}$/i.test(owner) || !/^[a-z0-9_.-]{1,100}$/i.test(name)) {
                  throw marketError("仓库参数无效", "error.market.badRepo");
                }
                const { entries, hash } = await fetchArchive({ owner, name, ref, path: "" });
                log("browse-repo", { owner, name, ref });
                return { skills: scanArchiveSkills(entries), commitHash: hash };
              });
            }
            if (method === "GET" && path === `${PREFIX}/installed`) {
              return run(w, () => listInstalled());
            }
            if (method === "GET" && path === `${PREFIX}/sources`) {
              return run(w, async () => ({
                builtin: BUILTIN_SOURCES,
                custom: await listSources(),
              }));
            }
            if (method === "GET" && path === `${PREFIX}/config`) {
              return run(w, () => readConfig());
            }
            if (method === "GET" && path === `${PREFIX}/check-updates`) {
              return run(w, () => checkUpdates());
            }
            if (method === "GET" && path === `${PREFIX}/trash`) {
              return run(w, () => listTrash());
            }
            if (method === "GET" && path === `${PREFIX}/detail`) {
              return run(w, async () => {
                const owner = url.searchParams.get("owner") || "";
                const name = url.searchParams.get("name") || "";
                const ref = url.searchParams.get("ref") || "main";
                const path = (url.searchParams.get("path") || "").replace(/^\/+|\/+$/g, "");
                const { entries } = await fetchArchive({ owner, name, ref, path });
                const bytes = entries[path ? `${path}/SKILL.md` : "SKILL.md"];
                if (!bytes) throw marketError("找不到 SKILL.md", "error.market.notSkill", 404);
                return parseSkillDoc(Buffer.from(bytes).toString("utf8"));
              });
            }
            if (method === "HEAD") {
              json(w, 405, { ok: false, error: "method not allowed" });
              return;
            }
            if (method !== "POST") {
              json(w, 405, { ok: false, error: `method not allowed: ${method}` });
              return;
            }

            const mutationError = validateMutationRequest(r, trusted);
            if (mutationError) {
              json(w, mutationError.statusCode, { ok: false, error: mutationError.error });
              return;
            }
            const body = await readBody(r);

            const result = await enqueueMutation(async () => {
              switch (path) {
                case `${PREFIX}/install`: {
                  const r = await installSkill(body as never);
                  log("install", r);
                  afterWrite();
                  return r;
                }
                case `${PREFIX}/uninstall`: {
                  const r = await uninstallSkill(body as never);
                  log("uninstall", body);
                  afterWrite();
                  return r;
                }
                case `${PREFIX}/trash-restore`: {
                  const r = await restoreTrash(body as never);
                  log("trash-restore", body);
                  afterWrite();
                  return r;
                }
                case `${PREFIX}/trash-purge`: {
                  const r = await purgeTrash(body as never);
                  log("trash-purge", body);
                  return r;
                }
                case `${PREFIX}/sources/add`: {
                  const r = await addSource(body as never);
                  log("source-add", body);
                  return r;
                }
                case `${PREFIX}/sources/remove`: {
                  const r = await removeSource(body as never);
                  log("source-remove", body);
                  return r;
                }
                case `${PREFIX}/config`: {
                  const r = await writeConfig(body as never);
                  log("config", body);
                  return r;
                }
                case `${PREFIX}/toggle`: {
                  const r = await toggleSkill(body as never);
                  log("toggle", body);
                  afterWrite();
                  return r;
                }
                case `${PREFIX}/update`: {
                  const r = await updateSkill(body as never);
                  log("update", { name: body?.name, result: r });
                  afterWrite();
                  return r;
                }
                default:
                  json(w, 404, { ok: false, error: `unknown action: ${path}` });
                  return undefined;
              }
            });
            // default 已写过响应（writableEnded 防护保证幂等），成功路径统一在此写回
            json(w, 200, { ok: true, data: result ?? null });
          } catch (error) {
            const e = error as { statusCode?: number; code?: string; message?: string };
            json(w, typeof e?.statusCode === "number" ? e.statusCode : 500, {
              ok: false,
              ...(typeof e?.code === "string" ? { code: e.code } : {}),
              error: String(e?.message ?? e),
            });
          }
        },
      }),
    `${NAME}: API route`,
  );
}

export { NAME as name };
