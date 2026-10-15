# Changelog

## 0.4.0 (2026-10-15)

### 新增
- 客户端左侧一级入口「技能商店」（sidebar.panellist + main 官方面板槽位，入口开关控制，设置入口常在）
- 安装进度实时反馈（下载 x/N 计数）+ 15 秒后可取消（AbortController 贯穿）
- 详情页 SKILL.md 正文预览（装前可审阅技能内容）
- 已装页来源筛选（商店安装/本地既有）与名称排序
- 仓库源内置 6 个（新增 addyosmani/agent-skills、K-Dense-AI/scientific-agent-skills、coreyhaines31/marketingskills、DietrichGebert/ponytail），内置源可移除/恢复
- 本地预览环境（scripts/preview.mjs + preview/，mock 宿主外壳 + 真实服务端桥接）
- 搜索清除按钮与结果计数；精选区「换一批」；ESC 关闭详情

### 修复
- 网络层重写：全部 GitHub 请求从 undici fetch 换 node:https（修复 Connect Timeout 导致的安装卡死）；DNS IPv4 优先
- 安装提速约 20 倍：按文件拉取（Git Trees API 一次列树 + raw 并发 6 路 + API raw 兜底），100-165s → 6s
- 入口开关时序竞态：gate 重写为 ready/wanted 状态机（宿主回调晚到不再覆盖显隐）
- 窄容器水平溢出；页签切换宽度跳动（容器宽度锁定 + 最小高度回退）
- 精选区滚动条隐藏 + 右缘渐隐；卡片名称单行截断（悬停显示全名）

### 变更
- GITHUB_TOKEN / DSH_SKILL_MARKET_TOKEN 环境变量支持（提升限流额度）
- 已装描述服务端截断 120 字符；回收站 30 天自动清理；诊断提示悬停说明

## 0.3.6 / 0.3.5 / 0.3.4 / 0.3.3 / 0.3.2 / 0.3.1 (2026-10-14)

迭代版本：侧边栏入口首版、货架来源管理、骨架屏、宽度锁定等多轮修复（细节见 git log）。

## 0.2.0 / 0.2.1 (2026-10-14)

首个公开版本：逛店 / 安装 / 管理（已装·回收站）/ 更新检查基础链路。

## 0.1.0 (2026-10-14)

内部骨架版。
