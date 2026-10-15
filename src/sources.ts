import { promises as fs } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { scanArchiveSkills, fetchArchive } from "./installer.ts";
import { marketError, marketHome } from "./paths.ts";

/**
 * 自定义仓库源管理：用户添加 GitHub 仓库作为货架货源，
 * 添加即扫描其中的 SKILL.md 技能；源可删除，技能安装走通用安装链路。
 */

export interface SourceRecord {
  id: string;
  owner: string;
  name: string;
  ref: string;
  addedAt: string;
}

interface SourcesFile {
  version: 1;
  sources: SourceRecord[];
  /** 被用户移除显示的内置源（owner/name），可通过重新添加恢复 */
  hiddenBuiltins?: string[];
}

export const SOURCES_PATH = () => join(marketHome(), "sources.json");

const OWNER_RE = /^[a-z0-9][a-z0-9-]{0,38}$/i;
const NAME_RE = /^[a-z0-9_.-]{1,100}$/i;
const MAX_SOURCES = 20;

async function read(): Promise<SourcesFile> {
  try {
    const info = await fs.lstat(SOURCES_PATH());
    if (info.isSymbolicLink() || !info.isFile() || info.size > 1 << 20) {
      throw marketError("源清单文件不安全", "error.market.state");
    }
    const value = JSON.parse(await fs.readFile(SOURCES_PATH(), "utf8"));
    if (!value || value.version !== 1 || !Array.isArray(value.sources)) {
      throw marketError("源清单格式无效", "error.market.state");
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, sources: [] };
    throw error;
  }
}

async function write(value: SourcesFile): Promise<void> {
  const tmp = `${SOURCES_PATH()}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), { flag: "wx" });
    await fs.rename(tmp, SOURCES_PATH());
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

function normalizeInput(input: { repo?: string; owner?: string; name?: string; ref?: string }): {
  owner: string;
  name: string;
  ref: string;
} {
  let owner = String(input.owner ?? "");
  let name = String(input.name ?? "");
  if (!owner || !name) {
    const raw = String(input.repo ?? "")
      .trim()
      .replace(/^https:\/\/github\.com\//i, "")
      .replace(/\.git$/, "");
    const parts = raw.split("/");
    owner = parts[0] ?? "";
    name = parts[1] ?? "";
  }
  owner = owner.toLowerCase();
  name = name.replace(/\.git$/, "").toLowerCase();
  const ref = String(input.ref ?? "main");
  if (!OWNER_RE.test(owner) || !NAME_RE.test(name)) {
    throw marketError("仓库地址无效，示例：anthropics/skills", "error.market.badRepo");
  }
  return { owner, name, ref };
}

export async function listSources(): Promise<SourceRecord[]> {
  return (await read()).sources;
}

/** 内置源可见性：返回过滤后的内置列表 + 已隐藏清单（供恢复） */
export async function builtinSourcesVisibility(): Promise<{
  visible: typeof BUILTIN_SOURCES;
  hidden: string[];
}> {
  const store = await read();
  const hidden = new Set(store.hiddenBuiltins ?? []);
  return {
    visible: BUILTIN_SOURCES.filter((b) => !hidden.has(`${b.owner}/${b.name}`)),
    hidden: [...hidden],
  };
}

/** 移除内置源显示（不删数据，可恢复） */
export async function hideBuiltinSource(input: { owner?: string; name?: string; repo?: string }): Promise<void> {
  const { owner, name } = normalizeInput(input);
  const key = `${owner}/${name}`;
  if (!BUILTIN_SOURCES.some((b) => `${b.owner}/${b.name}` === key)) {
    throw marketError("不是内置源，请用 sources/remove 移除自定义源", "error.market.notBuiltin");
  }
  const store = await read();
  store.hiddenBuiltins = Array.from(new Set([...(store.hiddenBuiltins ?? []), key]));
  await write(store);
}

/** 恢复内置源显示 */
export async function restoreBuiltinSource(input: { owner?: string; name?: string; repo?: string }): Promise<void> {
  const { owner, name } = normalizeInput(input);
  const key = `${owner}/${name}`;
  const store = await read();
  store.hiddenBuiltins = (store.hiddenBuiltins ?? []).filter((k) => k !== key);
  await write(store);
}

/** 添加源：立即扫描一次验证可达并统计技能数 */
export async function addSource(input: {
  repo?: string;
  owner?: string;
  name?: string;
  ref?: string;
}): Promise<SourceRecord & { skillCount: number }> {
  const { owner, name, ref } = normalizeInput(input);
  const store = await read();
  if (store.sources.some((s) => s.owner === owner && s.name === name)) {
    throw marketError("该仓库源已存在", "error.market.sourceExists");
  }
  // 内置源被移除过：重新添加即恢复显示
  const key = `${owner}/${name}`;
  if ((store.hiddenBuiltins ?? []).includes(key)) {
    store.hiddenBuiltins = (store.hiddenBuiltins ?? []).filter((k) => k !== key);
    await write(store);
    const { entries } = await fetchArchive({ owner, name, ref, path: "" });
    return {
      id: key,
      owner,
      name,
      ref,
      addedAt: new Date().toISOString(),
      skillCount: scanArchiveSkills(entries).length,
    };
  }
  if (store.sources.length >= MAX_SOURCES) {
    throw marketError(`最多添加 ${MAX_SOURCES} 个仓库源`, "error.market.tooManySources");
  }
  // 拉一次归档验证可达并统计技能（同时预热缓存）
  const { entries } = await fetchArchive({ owner, name, ref, path: "" });
  const skills = scanArchiveSkills(entries);
  const record: SourceRecord = {
    id: randomUUID(),
    owner,
    name,
    ref,
    addedAt: new Date().toISOString(),
  };
  store.sources.push(record);
  await write(store);
  return { ...record, skillCount: skills.length };
}

export async function removeSource(input: { owner?: string; name?: string; repo?: string }): Promise<void> {
  const { owner, name } = normalizeInput(input);
  const store = await read();
  const before = store.sources.length;
  store.sources = store.sources.filter((s) => !(s.owner === owner && s.name === name));
  if (store.sources.length === before) {
    throw marketError("源不存在", "error.market.notFound", 404);
  }
  await write(store);
}

/** 内置精选源的说明信息（展示用，不可删） */
export const BUILTIN_SOURCES = [
  { owner: "anthropics", name: "skills", label: "Claude 官方技能库", builtin: true },
  { owner: "obra", name: "superpowers", label: "开发方法论技能库", builtin: true },
  { owner: "addyosmani", name: "agent-skills", label: "工程方法论（25 技能）", builtin: true },
  { owner: "K-Dense-AI", name: "scientific-agent-skills", label: "科研技能库（177 技能）", builtin: true },
  { owner: "coreyhaines31", name: "marketingskills", label: "市场营销技能（50 技能）", builtin: true },
  { owner: "DietrichGebert", name: "ponytail", label: "多平台技能集（6 技能）", builtin: true },
];
