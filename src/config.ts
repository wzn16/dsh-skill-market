import { promises as fs } from "node:fs";
import { configPath, marketError, marketHome } from "./paths.ts";

/** 插件运行时配置（插件管理页的配置卡片读写） */
export interface MarketConfig {
  version: 1;
  /** 是否在设置侧边栏显示「技能商店」入口 */
  showEntry: boolean;
}

export const DEFAULT_CONFIG: MarketConfig = { version: 1, showEntry: true };

export async function readConfig(): Promise<MarketConfig> {
  try {
    const info = await fs.lstat(configPath());
    if (info.isSymbolicLink() || !info.isFile() || info.size > 64 << 10) {
      return { ...DEFAULT_CONFIG };
    }
    const value = JSON.parse(await fs.readFile(configPath(), "utf8")) as Partial<MarketConfig>;
    return { version: 1, showEntry: value.showEntry !== false };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function writeConfig(patch: Partial<MarketConfig>): Promise<MarketConfig> {
  const current = await readConfig();
  const next: MarketConfig = {
    version: 1,
    showEntry: typeof patch.showEntry === "boolean" ? patch.showEntry : current.showEntry,
  };
  await fs.mkdir(marketHome(), { recursive: true });
  const tmp = `${configPath()}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), { flag: "wx" });
    await fs.rename(tmp, configPath());
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw marketError(`配置写入失败：${(error as Error).message}`, "error.market.configWrite");
  }
  return next;
}
