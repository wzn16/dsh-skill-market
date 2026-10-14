import { homedir } from "node:os";
import { join } from "node:path";

/** 解析 DSH 主目录：环境变量优先，默认 ~/.dsh（跨平台，不硬编码本机路径） */
export function resolveDshHome(): string {
  return process.env.DSH_HOME || join(homedir(), ".dsh");
}

/** 用户技能根目录（安装目标） */
export function skillsRoot(): string {
  return join(resolveDshHome(), "skills");
}

/** 商店自身数据目录：登记表 / 缓存 / 回收站 */
export function marketHome(): string {
  return join(resolveDshHome(), "skill-market");
}

export function installsPath(): string {
  return join(marketHome(), "installs.json");
}

export function cacheDir(): string {
  return join(marketHome(), "cache");
}

export function trashDir(): string {
  return join(marketHome(), "trash");
}

export function logPath(): string {
  return join(marketHome(), "market.log");
}

export function configPath(): string {
  return join(marketHome(), "config.json");
}

/** 技能目录名约束：kebab-case，防 Windows 保留设备名与路径穿越 */
const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WINDOWS_DEVICE_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function validSkillName(name: string): boolean {
  return (
    typeof name === "string" &&
    name.length <= 100 &&
    KEBAB_RE.test(name) &&
    !WINDOWS_DEVICE_RE.test(name)
  );
}

/** zip 条目路径安全校验：拒绝绝对路径、..、反斜杠、控制字符 */
export function safeEntryPath(path: string): string {
  if (typeof path !== "string" || !path || path.length > 512) {
    throw marketError("技能包内存在不安全路径", "error.market.badPath");
  }
  const normalized = path.replace(/\/+$/, "");
  if (
    normalized.startsWith("/") ||
    normalized.includes("\\") ||
    normalized.split("/").some((p) => !p || p === "." || p === "..") ||
    /[\x00-\x1f]/.test(normalized) ||
    WINDOWS_DEVICE_RE.test(normalized)
  ) {
    throw marketError("技能包内存在不安全路径", "error.market.badPath");
  }
  return normalized;
}

/** 统一错误构造：带 code 与 HTTP 状态码 */
export function marketError(
  message: string,
  code = "error.market.invalid",
  statusCode = 400,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(message), { code, statusCode });
}
