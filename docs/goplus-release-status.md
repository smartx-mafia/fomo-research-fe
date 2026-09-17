# GoPlus 发布状态跟踪

更新时间：2026-09-17（Asia/Shanghai）。实现能力与历史验收结果见[交付说明](./goplus-update-delivery.md)和[前端实现交接](./goplus-frontend-handoff.md)。本文件只记录有证据的发布状态，不将实现验收等同于上线。

## 当前状态

| 项目 | 状态 |
|---|---|
| 前端提交范围 | 隔离工作树 `fomo-research-fe-goplus`，分支 `codex/goplus-enforcement`；本文件随本次 GoPlus 实现一起提交，最终 commit 以 Git 日志及交付回执为准 |
| 前端远端 `main` | 只读 `git ls-remote` 核验为 `f07140611f38709bf42aa9742616f4ee8d4a9034`，本轮未推送 |
| 父后端上线 | 父任务反馈已将最新 `79098cdf` 整合为 `0d6d3a57`，无冲突；build、14 包 race 与 3 包真实 PostgreSQL 通过，复审进行中；新 GET 响应待父任务验证。本任务未独立验证后端 |
| 本次 GoPlus Pages 部署 | 未触发，未上线验收 |
| 后端运行配置 | 父任务反馈测试机无 GoPlus 凭据，按 observe、采集关闭部署，已补服务 JWT；实际新 GET 响应待确认。代码具备 enforce 能力，但运行配置尚未启用，前端不得自行强制 |
| 真实交易 / 钱包 | 未操作，未执行真资金端到端 |

本次提交前直接审查了风险协议归一化、跨代币缓存隔离、R4 用户确认与版本绑定、R5 升级拦截和 Submit 不确定状态恢复，以及对应测试与 QA fixture，未发现阻断本次提交的问题。没有可用的独立审查子代理，因此本轮不是新增独立复审。针对本次风险与自选相关的 8 个测试文件重新执行：**79 项全部通过**。此前完整验收的 **493 pass / 1 skip、类型检查和生产构建通过**为实现阶段记录，本轮未重复运行全量测试或构建，业务源代码未再修改。提交前另做差异空白检查和凭据模式扫描，不纳入 `.env`、构建产物或登录文件。

## 既有 Pages 路径（2026-09-17 只读核实）

通过已有登录浏览器直接读取 Cloudflare 项目与设置；未改变配置、环境变量或部署状态。

| 设置 | 控制台证据 |
|---|---|
| Account / Project | `19f7b75b3407813ce248fd14eb8a002f` / `fomo-research-fe` |
| Git repository | `smartx-mafia/fomo-research-fe`，已连接 Cloudflare GitHub App |
| Production branch | `main` |
| Automatic deployments | `Enabled` |
| Root directory | `app` |
| Build command | `npx next build` |
| Build output | `out` |
| Build watch paths | Include `*` |
| Build system / cache | Version 3 / Disabled |
| Deploy Hooks | No deploy hooks defined；无需新增 hook |
| 生产地址 | [fomo-research-fe.pages.dev](https://fomo-research-fe.pages.dev/) |

来源：[Pages 项目](https://dash.cloudflare.com/19f7b75b3407813ce248fd14eb8a002f/pages/view/fomo-research-fe)、[生产设置](https://dash.cloudflare.com/19f7b75b3407813ce248fd14eb8a002f/pages/view/fomo-research-fe/settings/production)。其他工作分支已有 Preview 部署，因此推送工作分支也可能触发预览构建；本轮所有 push 均暂停。

已核实的既有生产部署：`24cc7d58-ea0b-400d-af99-789e7bfab569`，对应 `main` 的 `f07140611f38709bf42aa9742616f4ee8d4a9034`，状态 `success`，完成于 `2026-09-16T04:20:14Z`，构建部署用时 2m31s。该部署属于旧基线，不包含本次 GoPlus 更新。

- [Cloudflare deployment 详情](https://dash.cloudflare.com/19f7b75b3407813ce248fd14eb8a002f/pages/view/fomo-research-fe/24cc7d58-ea0b-400d-af99-789e7bfab569)
- [GitHub Cloudflare Pages check](https://github.com/smartx-mafia/fomo-research-fe/runs/104663811470)
- [旧部署固定地址](https://24cc7d58.fomo-research-fe.pages.dev/)

旧部署日志显示 Node `22.16.0`、pnpm `10.11.1`、自动 `pnpm install`，未找到 Wrangler 配置。本地实现验收使用 Node `24.19.0`、Corepack pnpm `11.17.0`。本轮不改构建配置；新提交在现有 Pages 环境的成功与否仍须以新 deployment 的日志为准。

本机 PATH 无 `gh` / `wrangler`；`Library/Preferences/.wrangler` 仅发现日志、registry 与元数据，无登录配置。当前进程未发现常用 Cloudflare/GitHub token 环境变量名。未回显秘密、创建令牌或运行登录授权。已有 Git 集成及浏览器登录足以核验、跟踪后续自动部署，常规发布不需要本机 Wrangler。

## 后端上线并收到发布指令后的动作

1. 等待父任务验证新风险 GET 响应，并明确下达 `push main` 指令；收到后核对后端上线证据、确认协议与依赖服务。observe / 采集关闭不等于代码缺失能力，前端沿用后端返回的 `mode`，不自行启用强制。仅做获授权的读取验收，不以创建交易或签名测试代替。
2. 在隔离前端执行下列 fetch，核对远端 `main`。若仍为上述基线并且是当前提交祖先，可以普通快进推送；若远端前进，先在隔离工作树整合并复核，不强推、不操作原 dirty 前端。
3. 发布指令到达后再执行 push 到 `main`，由既有 Git 集成触发生产部署。推送成功仅证明 Git 更新。
4. 查询新 SHA 对应的 Cloudflare Pages check 与 deployment，记录 commit、deployment ID、状态及固定 URL。核对生产域名展示新风险组件、静态资源可达，以及对已上线后端的只读风险请求成功；不连接钱包或发起交易。
5. 在本文件追加实际发布结果。失败时先保存日志并定位，不修改凭据、后端或启用 enforce；不把旧 deployment 的成功当成本次上线成功。

以下为**待执行命令**；本轮没有执行 fetch 或 push，远端校验使用 `ls-remote`：

```sh
git -c core.sshCommand='ssh -p 443 -o Hostname=ssh.github.com -o BatchMode=yes -o ConnectTimeout=10' fetch origin main
git merge-base --is-ancestor origin/main HEAD
# 仅在父后端上线、收到发布指令并完成上述核验后执行：
git -c core.sshCommand='ssh -p 443 -o Hostname=ssh.github.com -o BatchMode=yes -o ConnectTimeout=10' push origin HEAD:refs/heads/main
```
