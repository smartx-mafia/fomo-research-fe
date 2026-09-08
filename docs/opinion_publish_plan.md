# Opinion 发布流程前端接入规划

> 依据：后端合同 `smartx-backend/docs/contracts/social.md`（2026-09-07 版，本地 clone：
> `/Users/a11111/Desktop/code/golang/poly/smartx-backend`）、`portfolio.md` + `portfolio.proto`、
> `invite.md` §4/§5；前端现状：`app/src/api/social-content.ts`、`SquareFeed.tsx`、
> `PortfolioView.tsx`、`FiatDepositCard.tsx`（幂等意图模式参照）。

## 0. 结论与三个关键发现

1. **API 客户端已就绪**：`social-content.ts` 已封装 create / update / by-target / history /
   like / unlike，含五个实测编码坑的归一化。缺的只有 `deleteOpinion`（合同 #3）和 UI 层。
2. **阻塞性缺口——前端拿不到 `round`**。`target_id = chain_id:kind:token_id:round`
   （social.md §3.1，直连 `app.portfolio_positions` 主键后四列），但 portfolio HTTP 合同
   在 2026-09 迁移时已把 `round` 从全部响应中移除：
   - `GET /v1/portfolio` 的 `PortfolioPosition` 只有 `asset.{chain_id,kind,token_address}` +
     `current_cycle.opened_entry_id`（proto 里 `Position` 消息虽有 `round=9`，但**没有任何
     RPC 返回该消息**）；
   - `GET /v1/portfolio/position/history` 明确"不提供展示轮序号"（portfolio.md §3.1）；
   - social.md §3.1"从持仓接口的 token.chain_id/kind/token.id/round 拼接"相对 portfolio
     合同是**陈旧引用**（那是旧版 portfolio 词汇，见 portfolio.md §4.1 迁移注记）。
   绕过方案都不可行：拿 `opened_entry_id` 冒充 `round` → `200103`；猜 `round=1` → 多轮
   token 全错。**必须由后端在持仓接口补一个字段**（见 §1，additive、极小）。
3. **门禁码迁移**：已登录未准入 = `430114 BIZ_INVITE_NOT_ADMITTED`（2026-09-05 起，
   social/favorites/deposits 全部 Required 端点）。前端现在全局按 `430113` 处理门禁是旧
   语义——invite.md 里 `430113` 现在是"邀请码名额满"（只出现在 bind 流程）。

另：2026-09-07 合同新增了 `refresh_anchor` + `GET /v1/social/square/feed/updates`
未读气泡端点（social.md §6.2），与发布流程独立，列为 Phase 2。

## 1. 后端前置（阻塞项，改动极小）

- `portfolio.proto` 的 `PortfolioCurrentCycle` 增加 `int32 round = 6;`
  （本轮轮次号，从 1 开始；0/缺席 = 周期未就绪，"仅 open 仓会出现 0"语义与既有
  `Position.round` 注释一致）。数据同表已有（`app.portfolio_positions.round_no`），
  纯读取透出，proto 只增不改。
- 同步 `portfolio.md` §2.2.1 字段表 + `portfolio.openapi.json`。
- （Phase 2，非阻塞）`PortfolioHistoryEntry` 增加 `round`，才能支持"对已清仓轮发表"。
- 联调验证路径：发 opinion → NEWEST lane 可见，卡片 `position` 摘要来自该轮。

## 2. 前端工作分解

### M1 API 层补齐

| 文件 | 工作 |
|---|---|
| `src/api/social-content.ts` | 新增 `deleteOpinion(bearer, opinionID): Promise<{changed: boolean}>`（DELETE `/v1/social/opinions/{id}`，`changed` 缺席 = false，重复删除幂等成功） |
| `src/api/portfolio.ts` | `PortfolioCurrentCycle` 解析 `round`（int32；0/缺席 = 未就绪，不得读成"第 0 轮"） |
| `src/lib/` 或 `src/api/social-content.ts` | `positionTargetID(position)`：`${chain_id}:${kind}:${token_address}:${round}`，链号/轮次按十进制数值直接拼接（**不带前导零/正号**，`056:…:01` 会被拒 100102）；round 未就绪返回 undefined |
| 测试 | target_id 规范形态（含前导零拒绝用例）、delete 归一化、round=0 的降级 |

### M2 `OpinionComposer` 组件（核心）

状态机（create / edit 二合一，因 author+target 仅一条 Opinion）：

1. 打开时（有 bearer 才开）→ `getOpinionByTarget('POSITION', targetID)`：
   - 查到 → **编辑模式**：预填 `latestVersion.body` + 已有 X 链接；
     `baseVersionID` 取**打开那一刻**的快照（乐观并发控制）；
   - `200100`（无）→ 创建模式；`400000` → 会话过期 `clearSite()` + 登录引导；
     `430114` → 跳邀请准入（invite.md §4，开放期 `POST /v1/invite/bind`）。
2. 字段与校验（客户端先行，最终以后端为准）：
   - 正文：280 **加权**字符（CJK 计 2）实时计数器；提交前 trim（服务端会做 Unicode
     规范化 + 去首尾空白，**回包 body 是规范化形态**，发布后 UI 用回包值，不要本地回显）；
   - 附件：可选 X 链接，白名单 `https://x.com/…` / `https://twitter.com/…`，v1 单条。
3. **幂等意图模式**（照抄 `FiatDepositCard`）：
   - 提交前生成 `opinion-${crypto.randomUUID()}`（可打印 ASCII，满足要求）；
   - 先把 `{targetID, mode, opinionID?, baseVersionID?, body, items, idempotencyKey}`
     写 localStorage **再**发请求；
   - 结果不确定（网络/传输错误、500097）：保留意图，重试**只准**用同一 key + 同一内容
     （同 key 同 body = 回放首次结果）；
   - 确定性业务失败：清除意图。三个特殊的：
     - `600100`（审查拦截）：清除意图 + **必须换新 key**（被拦内容同 key 重试仍 600100；
       改了内容再发同 key 会撞 420100）；展示 `metadata.rule_id` 可用于申诉归因；
     - `420101`（base_version 过期）：重拉 getOpinionByTarget 刷新快照，用户确认后
       **新 key + 新 baseVersionID** 重试，不允许盲覆盖；
     - `430103`（创建时已存在）：自动切编辑模式（另一标签页抢先发布的竞态）。
   - `420100`：前端 bug 级别（同 key 不同内容），提示并换 key。
4. 提交成功：展示回包 Opinion（新 `versionNo`、规范化 body）；清除意图；回调宿主页面
   （刷新 NEWEST lane 或 `router.push('/square?lane=newest')`）。
5. 删除（编辑模式内）：confirm → `deleteOpinion`；`200100` 按"已删除"幂等成功；
   删除后可重新发表（新 Opinion 新 ID）。
6. 错误码展示文案走 `src/api/codes.ts`（social 域映射已齐，见 M4 补 430114）。

### M3 入口：`PortfolioView` 持仓行

- `PositionRow` 增加"发布观点"按钮（target = POSITION 的唯一自然入口）：
  - `current_cycle.round` 未就绪/缺席 → 按钮禁用，提示"本轮计算中"；
  - 未登录 → 登录引导；已发表与否**不在列表预查**（无批量端点，N 次 by-target 查询
    不划算），点开 composer 时才知道；编辑模式打开即是"已发表"的证据。
- 弹层样式与现有卡片/对话框一致（`border-border`/`bg-surface` 体系）。

### M4 错误码对齐（可独立先行）

- `codes.ts`：`430113` 文案改为"邀请码名额满"（仅 bind 流程出现）；新增
  `430114 BIZ_INVITE_NOT_ADMITTED`（门禁 → 跳准入，**不要重试、不要当登录失效**）。
- 迁移四个组件里的门禁分支 `430113` → `430114`：`SquareFeed.tsx`（requestError）、
  `SearchBox.tsx`、`TradePanel.tsx`、`PortfolioView.tsx`。
- `SquareFeed.requestError` 增加 430114 分支（FRIENDS lane 也受门禁）。

### M5（Phase 2，独立）广场未读气泡

- `social-content.ts`：`SquareFeedData` 捕获 `refresh_anchor`（会话内每页同值，按 lane
  覆盖存；仅手动刷新时更新）；新增 `fetchSquareFeedUpdates(lane, anchor?)`
  （anchor 缺省 → `count=0`，不传锚点别拿 next_cursor 冒充）。
- `SquareFeed`：≤30s 轮询 + 回前台补一次；气泡"N 条新动态 + 3 头像"（`has_more` →
  `99+`）；`100103` → 丢锚重拉首屏；匿名问 FRIENDS 得 400000 → 登录引导。

## 3. 里程碑与顺序

```
后端 round 字段（§1，阻塞） ──┐
                              ├─> M1 API 层 ─> M2 Composer ─> M3 入口     【可发布闭环】
M4 错误码对齐（随时可做，建议最先，纯前端）                                【修复现存门禁错配】
M5 未读气泡（独立排期）                                                    【2026-09-07 新合同】
```

## 4. 验收清单（对照 social.md §7）

- [ ] 创建：正常发 / 280 边界（CJK 计 2）/ 空 body 100100 / 非 X 链接 100101
- [ ] target_id：round 带前导零被拒 100102；round 未就绪按钮禁用；200103（持仓不存在）
- [ ] 幂等：同 key 同内容重试回放；同 key 改内容 420100；网络中断后同 key 重试成功
- [ ] 并发：双标签页编辑，后提交者 420101 → 重拉流程
- [ ] 竞态：另一端已发布后创建 → 430103 自动转编辑
- [ ] 审查：命中词 600100 → 编辑换 key 后可发；`rule_id` 展示
- [ ] 删除 → 不可见；重复删除幂等；删除后重发得新 opinion_id
- [ ] 门禁：未登录 400000 → 登录页；未准入 430114 → 准入流程（非重试）
- [ ] 广场闭环：NEWEST 匿名可见；卡片 position 摘要（token_symbol/pnl_percent）来自所钉轮次
