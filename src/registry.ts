import { promises as fs } from "node:fs";
import { join } from "node:path";
import { cacheDir, marketError } from "./paths.ts";

/** 技能仓库来源：GitHub 公开仓库 + 子目录定位 */
export interface RepoRef {
  owner: string;
  name: string;
  ref: string;
  path: string;
}

/** registry 中的一条精选技能 */
export interface RegistryEntry {
  name: string;
  description: string;
  category: string;
  tags: string[];
  repo: RepoRef;
  icon?: string;
  featured?: boolean;
  /** 来源仓库 star 数（运营侧写入，用于热度展示） */
  stars?: number;
  addedAt?: string;
}

export interface Registry {
  version: 1;
  updatedAt: string;
  categories: { id: string; label: string }[];
  skills: RegistryEntry[];
}

export const REGISTRY_CATEGORIES: Registry["categories"] = [
  { id: "office", label: "办公协同" },
  { id: "dev", label: "开发工具" },
  { id: "content", label: "内容创作" },
  { id: "docs", label: "文档处理" },
  { id: "meta", label: "技能与商店" },
];

/**
 * 内置精选种子（开箱即用，不依赖任何远程源）。
 * 货源：anthropics/skills（Claude 官方技能库，全量收录）+ obra/superpowers（社区高星方法论库）。
 * 条目的 path 以安装时实际校验为准；star 为 2026-10-14 快照。
 */
export const SEED_REGISTRY: Registry = {
  version: 1,
  updatedAt: "2026-10-14T00:00:00.000Z",
  categories: REGISTRY_CATEGORIES,
  skills: [
    // —— anthropics/skills（Claude 官方技能库，全量 19 个）——
    e("docx", "创建、编辑、检查 Word 文档（.docx），含报告、信函与格式化表格", "docs", ["docx", "word", "office"], "📄", true),
    e("xlsx", "创建、修改、分析 Excel 工作簿（.xlsx），支持公式、格式化与数据分析", "docs", ["xlsx", "excel", "office"], "📊", true),
    e("pptx", "创建、编辑、检查 PowerPoint 演示文稿（.pptx），含版式与备注", "docs", ["pptx", "powerpoint", "office"], "📽️", true),
    e("pdf", "PDF 文本与表格提取、创建、合并拆分与格式转换", "docs", ["pdf"], "📕", true),
    e("doc-coauthoring", "结构化协作共创文档：信息收集 → 精修 → 读者测试三阶段引导", "docs", ["writing", "collaboration"], "📝"),
    e("canvas-design", "生成视觉设计与海报级别的 .md/.html 视觉作品", "content", ["design", "poster"], "🎨", true),
    e("brand-guidelines", "按品牌规范应用 Anthropic 官方品牌风格于各类产物", "content", ["brand", "design"], "🏷️"),
    e("algorithmic-art", "用算法生成艺术：粒子流、噪声场等生成式 AI 艺术品", "content", ["art", "generative"], "🌌"),
    e("slack-gif-creator", "用组合表情动画制作 Slack GIF 动图", "office", ["slack", "gif"], "💬"),
    e("internal-comms", "撰写组织内部通讯：3P 更新、公司新闻与 HR 类文稿", "office", ["writing", "comms"], "✉️"),
    e("mcp-builder", "创建高质量 MCP 服务器，快速为 LLM 接入外部能力", "dev", ["mcp", "server"], "🧩", true),
    e("skill-creator", "设计并编写符合最佳实践的高质量技能包（SKILL.md）", "meta", ["skill", "meta"], "🛠️", true),
    e("webapp-testing", "用 Playwright 对本地 Web 应用做自动化测试与调试", "dev", ["testing", "playwright"], "🧪"),
    e("web-artifacts-builder", "构建复杂 Web artifacts：React/Tailwind 无构建原型的最佳实践", "dev", ["frontend", "artifacts"], "🖼️"),
    e("frontend-design", "避免模板感的前端设计：真实设计系统与品味驱动", "dev", ["frontend", "design"], "✨", true),
    e("claude-api", "用 Claude API 开发：流式、工具调用、批处理与提示词工程", "dev", ["api", "claude"], "🤖"),
    e("theme-factory", "从截屏提取主题风格并批量生成艺术主题集", "dev", ["theme", "style"], "🎭"),
    e("academy-guide", "Anthropic Academy 学习指南与课程导航", "meta", ["learning", "academy"], "🎓"),
    e("discernment-nudge", "在关键判断处停下来核实而非盲从，提升决策质量", "meta", ["thinking", "judgment"], "⚖️"),
    // —— obra/superpowers（社区高星方法论库，全量 15 个）——
    s("brainstorming", "把模糊想法通过结构化追问变成成熟设计方案，再落成文档", "meta", ["thinking", "design"], "💭", true),
    s("using-superpowers", "superpowers 技能体系的入口导航：按任务找到对的技能", "meta", ["navigation"], "🧭"),
    s("writing-skills", "编写高质量 SKILL.md：结构、命名与触发词的工艺", "meta", ["skill", "writing"], "✍️"),
    s("systematic-debugging", "系统化调试：先定位根因再动手修，拒绝盲改", "dev", ["debugging", "workflow"], "🔍", true),
    s("test-driven-development", "TDD 红绿重构循环：测试先行驱动实现", "dev", ["testing", "tdd"], "🧪"),
    s("verification-before-completion", "声称完成前必须先跑验证、拿证据", "dev", ["verification", "workflow"], "✅"),
    s("writing-plans", "把设计写成可执行的实施计划文档", "dev", ["planning", "workflow"], "📐"),
    s("executing-plans", "按计划文档逐任务执行并持续推进", "dev", ["execution", "workflow"], "⚙️"),
    s("using-git-worktrees", "用 git worktree 隔离并行开发，互不踩脚", "dev", ["git", "workflow"], "🌳"),
    s("finishing-a-development-branch", "开发分支收尾：合并、清理与交付的完整流程", "dev", ["git", "workflow"], "🏁"),
    s("requesting-code-review", "发起高质量代码评审：说明意图与检查点", "dev", ["code-review", "workflow"], "📣"),
    s("receiving-code-review", "以开放心态接收评审意见并有效响应", "dev", ["code-review", "workflow"], "🤝"),
    s("subagent-driven-development", "用子代理驱动开发：委派、汇总与验收", "dev", ["subagent", "workflow"], "🤹"),
    s("dispatching-parallel-agents", "并行派发多个子代理加速大任务", "dev", ["parallel", "workflow"], "🚀"),
    s("diagnosing-superpowers", "排查 superpowers 技能体系自身的异常", "dev", ["debugging", "meta"], "🩺"),
  ],
};

/** anthropics/skills 条目（统一 repo 与 star 快照） */
function e(
  name: string,
  description: string,
  category: string,
  tags: string[],
  icon: string,
  featured = false,
): RegistryEntry {
  return {
    name,
    description,
    category,
    tags,
    icon,
    featured,
    stars: 181006,
    addedAt: "2026-10-14",
    repo: { owner: "anthropics", name: "skills", ref: "main", path: `skills/${name}` },
  };
}

/** obra/superpowers 条目（统一 repo 与 star 快照） */
function s(
  name: string,
  description: string,
  category: string,
  tags: string[],
  icon: string,
  featured = false,
): RegistryEntry {
  return {
    name,
    description,
    category,
    tags,
    icon,
    featured,
    stars: 298840,
    addedAt: "2026-10-14",
    repo: { owner: "obra", name: "superpowers", ref: "main", path: `skills/${name}` },
  };
}

/** 远程 registry 地址：env 可覆盖；默认指向本项目运营仓库（尚未建，失败即回落 seed） */
export function remoteRegistryUrl(): string {
  return (
    process.env.DSH_SKILL_MARKET_REGISTRY ||
    "https://raw.githubusercontent.com/wzn16/dsh-skill-market/main/registry.json"
  );
}

const REGISTRY_TTL_MS = 60 * 60 * 1000;
const REVALIDATE_MIN_INTERVAL_MS = 10 * 60 * 1000;

interface CacheEntry {
  fetchedAt: number;
  registry: Registry;
}

let memoryCache: CacheEntry | null = null;
let lastRevalidateAt = 0;

function validateRegistry(input: unknown): Registry {
  const value = input as Registry;
  if (
    !value ||
    value.version !== 1 ||
    !Array.isArray(value.skills) ||
    value.skills.length > 2000 ||
    !Array.isArray(value.categories)
  ) {
    throw marketError("registry 格式无效", "error.market.registryInvalid");
  }
  for (const s of value.skills) {
    if (
      !s ||
      typeof s.name !== "string" ||
      typeof s.description !== "string" ||
      !s.repo ||
      typeof s.repo.owner !== "string" ||
      typeof s.repo.name !== "string"
    ) {
      throw marketError("registry 条目无效", "error.market.registryInvalid");
    }
  }
  return value;
}

/** 读磁盘缓存（不检查新鲜度——旧缓存也先渲染，后台再刷新） */
async function readDiskCache(): Promise<Registry | null> {
  try {
    const path = join(cacheDir(), "registry.json");
    const info = await fs.lstat(path);
    if (!info.isFile()) return null;
    return validateRegistry(JSON.parse(await fs.readFile(path, "utf8")));
  } catch {
    return null;
  }
}

async function writeDiskCache(registry: Registry): Promise<void> {
  const dir = cacheDir();
  await fs.mkdir(dir, { recursive: true });
  const diskCache = join(dir, "registry.json");
  const tmp = `${diskCache}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(registry), { flag: "wx" });
  await fs.rename(tmp, diskCache);
}

/** 后台静默刷新（10 分钟节流，失败不影响当前响应） */
function revalidateInBackground(url: string): void {
  if (Date.now() - lastRevalidateAt < REVALIDATE_MIN_INTERVAL_MS) return;
  lastRevalidateAt = Date.now();
  void fetchRemoteRegistry(url)
    .then(async (registry) => {
      memoryCache = { fetchedAt: Date.now(), registry };
      await writeDiskCache(registry).catch(() => {});
    })
    .catch(() => {});
}

async function fetchRemoteRegistry(url: string): Promise<Registry> {
  const response = await fetch(url, {
    redirect: "error",
    // 网络挂起时快速失败回落缓存/种子，不让商店白屏等待
    signal: AbortSignal.timeout(6_000),
    headers: { "User-Agent": "dsh-skill-market" },
  });
  if (!response.ok) throw marketError(`registry 拉取失败（HTTP ${response.status}）`, "error.market.network");
  return validateRegistry(JSON.parse(await response.text()));
}

/**
 * 获取精选 registry（stale-while-revalidate，修复网络挂起导致的白屏）：
 * 1) 内存新鲜 → 毫秒级返回；
 * 2) 磁盘有缓存（无论新旧）→ 立即返回 + 后台静默刷新，绝不阻塞渲染；
 * 3) 首次无缓存 → 6s 短超时拉远程，失败回落内置 seed。
 */
export async function getRegistry(): Promise<{ registry: Registry; source: string }> {
  if (memoryCache && Date.now() - memoryCache.fetchedAt < REGISTRY_TTL_MS) {
    return { registry: memoryCache.registry, source: "memory" };
  }
  const url = remoteRegistryUrl();
  const cached = await readDiskCache();
  if (cached) {
    memoryCache = { fetchedAt: Date.now(), registry: cached };
    if (!url.startsWith("file://")) revalidateInBackground(url);
    return { registry: cached, source: "cache" };
  }
  if (url.startsWith("file://")) {
    try {
      const registry = validateRegistry(
        JSON.parse(await fs.readFile(url.slice("file://".length), "utf8")),
      );
      memoryCache = { fetchedAt: Date.now(), registry };
      return { registry, source: "file" };
    } catch {
      return { registry: SEED_REGISTRY, source: "seed" };
    }
  }
  try {
    const registry = await fetchRemoteRegistry(url);
    memoryCache = { fetchedAt: Date.now(), registry };
    await writeDiskCache(registry).catch(() => {});
    return { registry, source: "remote" };
  } catch {
    return { registry: SEED_REGISTRY, source: "seed" };
  }
}

// ---------- 实时 star（按仓库缓存，修复静态快照过时） ----------

const STARS_TTL_MS = 60 * 60 * 1000;

interface StarsCacheFile {
  version: 1;
  repos: Record<string, { stars: number; fetchedAt: number }>;
}

async function readStarsCache(): Promise<StarsCacheFile> {
  try {
    const path = join(cacheDir(), "stars.json");
    const info = await fs.lstat(path);
    if (!info.isFile()) throw new Error("no cache");
    return JSON.parse(await fs.readFile(path, "utf8")) as StarsCacheFile;
  } catch {
    return { version: 1, repos: {} };
  }
}

async function writeStarsCache(cache: StarsCacheFile): Promise<void> {
  const dir = cacheDir();
  await fs.mkdir(dir, { recursive: true });
  const path = join(dir, "stars.json");
  const tmp = `${path}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cache), { flag: "wx" });
  await fs.rename(tmp, path);
}

async function getRepoStarsCached(owner: string, name: string): Promise<number | null> {
  const key = `${owner}/${name}`;
  const cache = await readStarsCache();
  const hit = cache.repos[key];
  if (hit && Date.now() - hit.fetchedAt < STARS_TTL_MS) return hit.stars;
  try {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
      redirect: "error",
      signal: AbortSignal.timeout(6_000),
      headers: { Accept: "application/vnd.github+json", "User-Agent": "dsh-skill-market" },
    });
    if (!response.ok) return hit ? hit.stars : null;
    const body = (await response.json()) as { stargazers_count?: unknown };
    if (typeof body.stargazers_count !== "number") return hit ? hit.stars : null;
    cache.repos[key] = { stars: body.stargazers_count, fetchedAt: Date.now() };
    await writeStarsCache(cache).catch(() => {});
    return body.stargazers_count;
  } catch {
    return hit ? hit.stars : null;
  }
}

/** 用实时 star 覆盖 registry 的静态快照（按仓库去重请求；失败保留原值） */
export async function withLiveStars(registry: Registry): Promise<Registry> {
  const repos = Array.from(
    new Set(registry.skills.map((s) => `${s.repo.owner}/${s.repo.name}`)),
  );
  const live = await Promise.all(
    repos.map(async (key) => {
      const [owner, name] = key.split("/");
      return [key, await getRepoStarsCached(owner, name)] as const;
    }),
  );
  const byRepo = new Map(live.filter(([, v]) => v !== null) as [string, number][]);
  if (byRepo.size === 0) return registry;
  return {
    ...registry,
    skills: registry.skills.map((s) => {
      const n = byRepo.get(`${s.repo.owner}/${s.repo.name}`);
      return typeof n === "number" ? { ...s, stars: n } : s;
    }),
  };
}
