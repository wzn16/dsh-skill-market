# dsh-skill-market

DeepSeek Harness（DSH）可视化技能商店：逛一逛，点一下，装好。

对标 WorkBuddy SkillHub 的商店体验——分类浏览、卡片流、搜索、精选、一键安装，
外加内建管理（已装列表 / 卸载 / 回收站恢复）。纯前端 + 本地实现，无后端、零运行时依赖。

## 功能

- **逛店**：精选技能、分类筛选（办公协同 / 开发工具 / 内容创作 / 文档处理 / 技能与商店）、中英文搜索
- **安装**：一键从 GitHub 公开仓库安装技能包（SKILL.md + 资源），同名冲突保护，归档级缓存（同仓库第二个技能秒装）
- **管理**：已装列表（区分商店安装 / 本地既有）、卸载进回收站、恢复、彻底删除
- **货架运营**：精选清单（registry）支持远程仓库覆盖 + 内置种子兜底，社区经 PR 上架

## 安装

```bash
dsh plugin add dsh-skill-market
```

或在 DSH 客户端插件市场搜索 `dsh-skill-market`（收录后可用）。

## 使用

安装后打开 DSH 设置，侧边栏会出现「技能商店」入口。

## 架构

```
src/          服务端（cordis 插件，挂 /api/dsh-skill-market 路由）
  index.ts      插件入口：路由注册 + 请求来源校验
  registry.ts   精选清单：远程拉取（raw/jsdelivr）+ 磁盘缓存 + 内置种子兜底
  installer.ts  安装 / 卸载 / 已装扫描 / 回收站
  unzip.ts      零依赖 zip 解包（Node 内置 zlib）
  paths.ts      目录解析（DSH_HOME 跨平台）
client/       客户端（React，经 __ModuleLoader__ 注入设置页）
  index.tsx     settings.section 注册
  App.tsx       逛店 / 已装 / 回收站三视图
scripts/
build.mjs     esbuild 双端打包
```

技能包安装到 `~/.dsh/skills/`（尊重 `DSH_HOME` 环境变量），与 DSH 原生技能加载、
skills-manager 等管理工具共存不冲突。

## 安全

- 所有变更请求校验来源（loopback / 可信主机 + 专属标记头）
- 技能包路径逐条校验（防路径穿越 / Windows 保留名 / 符号链接逃逸）
- 解压体积双重限额（32 MiB 压缩 / 64 MiB 展开）
- 上架清单人工审核；第三方技能的 SKILL.md 本质是提示词，安装前请知悉来源

## License

MIT
