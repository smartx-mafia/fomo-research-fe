# GoPlus 风控更新交付说明

版本：2026-09-17 · 实现验收快照

读者：产品、前端、后端、测试、发布负责人

范围：本次 GoPlus 接入及其与 Codex 的统一风险评估、推荐准入和买入限制，不包含其他业务更新。

> **实现验收快照（2026-09-17）：本地代码已实现并完成本轮测试、复审。本文记录实现能力与当时验收结果，不表示已经上线。**
> 提交、推送、后端部署、Pages 部署及线上验证状态单独记录在[发布状态跟踪](./goplus-release-status.md)，后续发布不改写本节验收快照。
> 默认示例为 `goplus.enforce: false`。本文中的“已接入”表示代码能力，不代表线上已启用，也不代表供应商对所有链、所有代币都有数据。
> **实现能力与运行配置分别验收**：代码已具备统一评估、推荐准入与买入限制能力；实际运行可能尚未启用。父任务于 2026-09-17 反馈：测试机无 GoPlus 凭据，本次后端按 observe、采集关闭部署，已补服务 JWT，新 GET 响应仍待验证。此运行方式不表示代码缺少强制能力；前端只服从后端返回的 `mode`，不得自行开启 enforce。后续实际状态见发布跟踪。

## 1. 本次更新了什么

原有标准代币协议已经包含 Codex 风险。本次在其上增加 GoPlus 证据和统一评估，不另建仅供详情页使用的孤立风险协议。

| 更新项 | 本次交付 |
|---|---|
| 标准代币数据 | 在现有 `risk` 中新增 `assessment`，承载 GoPlus＋Codex 评估 |
| 数据来源 | GoPlus EVM/Solana Token Security 适配，解析已返回的 B20 权限字段；保留 Codex 风险 |
| 风险分级 | `grade=0` 表示未知；`1..5` 对应 R1—R5，检查完整性独立表达 |
| 推荐准入 | enforce 模式下，榜单、关键词搜索、Square ForYou 只接受检查完整的 R1—R3 |
| 买入限制 | Trade/FastSwap 后端执行 R4 明确确认、R5 禁买，并在首次广播前复核 |
| 前端交互 | 普通交易页面增加风险条、原因详情、R4 确认弹层、R5 禁买说明和过期展示 |
| 风险持久化 | 独立 PostgreSQL 证据、观测、确认记录和单调版本；不依赖行情缓存保留限制 |
| 成本控制 | 后台需求驱动采集，跨副本分钟/日/月请求预算；页面响应不等待 GoPlus |

不改变价格、成交量、持有人数量等行情字段的来源；不把 GoPlus 当作补齐 Dev/Sniper/Insider/Bundler 持仓比例的方案。

## 2. 覆盖的返回面和执行面

### 2.1 标准数据返回

已有标准 `TokenRisk` 的元数据单查/批量、行情、Overview、搜索、详情数据、榜单 HTTP/WS、单币 WS，以及经标准代币数据装配的持仓、历史和 Social 返回，统一携带增强风险。

- 风险是动态数据，与静态 `TokenInfo` 分开；不要把评估写进静态名称/符号对象。
- 各接口仍使用其原有嵌套位置，不表示每个 HTTP 响应的根节点都增加一个 `risk`。
- 搜索结果新增条目级 `risk`；即使 `market` 缺席，也可以返回风险，不补造零价格。
- 前端单查/批量元数据、行情、Overview、搜索、榜单 WS 的解析保留完整评估；自选元数据缓存保留风险。
- 公共读取复用批量风险读取，避免按列表条目逐个请求供应商。

### 2.2 执行边界

| 场景 | enforce 模式下的行为 |
|---|---|
| 榜单/推荐候选 | 在截断、缓存发布及读取环节检查资格 |
| `board:trending` 等榜单 WS | 快照过滤；风险不再允许的更新转换为移除，保持原事件序列语义 |
| 关键词搜索 | 检查资格，缓存命中也复核；不能以结果缓存绕过 |
| 完整合约地址查询 | 保留查询能力并展示风险；地址前缀、名称精确匹配不享受该例外 |
| 详情、自选、持仓、交易历史 | 保留资产与事实，不因 R4/R5 从用户记录中删除 |
| Square ForYou | 使用统一风险资格；Newest/Friends 的历史事实保留 |
| Trade / FastSwap 买入 | 后端独立复核，不信任客户端自报“已确认” |
| 卖出 | 按实际资产、路由和执行能力独立判断；不保证一定能卖出 |

当前仓库没有独立的 Square 主动 push 发送队列，本次不宣称已接入该队列。FastSwap 后端已接入，但本次隔离前端基线没有 FastSwap 页面，该页面 UI 尚未接入。

## 3. 前端新增数据协议

### 3.1 新旧字段不能混用

既有 `risk.result_is_scam`、`token_is_scam`、`potential_scam_reasons`、`quality`、`level` 保留 Codex 语义。

**`risk.level` 不是 R1—R5。** 它仍为 `0=UNKNOWN / 1=NO_FLAG_REPORTED / 2=POTENTIAL / 3=SCAM`。本次统一风险分级读取 `risk.assessment.grade`。

### 3.2 `risk.assessment` 字段

| 字段 | 用途 / 接入约束 |
|---|---|
| `mode` | `observe` 预热观测；`enforce` 启用本次限制；空值是旧协议/未知，不当作 R1 |
| `grade` | `0` 未知，`1..5` 为 R1—R5；不能由前端根据原始证据重新计算 |
| `checks_complete` | 必需检查是否完整且有效；与已有风险等级独立 |
| `policy_version` | 本次规则版本 `goplus-codex-r1-r5-v1` |
| `decision_version` | 风险原因/参数的稳定摘要；不是买入确认凭据 |
| `items` | 归并后的风险原因列表 |
| `checks` | 检查项及状态，不等同于阳性原因列表 |
| `goplus_status` | `pending/ok/stale/unavailable/error/rate_limited/not_found/unsupported/storage_error` |
| `goplus_observed_at_ms` | 可空，最近有效 GoPlus 观测时间 |
| `last_attempt_at_ms` | 可空，最近尝试时间；失败不能冒充新的成功观测 |
| `recommendation_allowed` | 推荐资格；是否执行同时受 `mode` 控制 |
| `keyword_search_allowed` | 关键词搜索资格；完整地址查询另有保留规则 |
| `square_distribution_allowed` | Square 主动分发资格；当前接入 ForYou |
| `buy_action` | `allow / confirm / block / unavailable`，仅用于买入 |
| `confirmation_version` | 用户风险确认绑定的完整不透明字符串，不截断、不自行拼接 |
| `valid_until_ms` | 可空，必需检查的共同有效截止时间；前端用其显示过期，不解除已知风险 |

`items[]` 包含 `code、grade、display_source、evidence、params`：

- `code` 对应前端固定文案，不直接展示供应商自由文本。
- `evidence[]` 包含 `source、field、value、observed_at_ms`，用于证据追踪，不用于前端重新分级。
- 税费 `params.rate` 是**百分数字符串**：`"3.88"` 显示为 `3.88%`；不能再次乘以 100。原始证据中的 `"0.0388"` 不直接作为展示百分比。
- 创建者关联蜜罐数量使用 `params.count`，保留整数精度，不当成布尔值。
- `checks[]` 包含 `code、state、value`；状态为 `clear/flagged/unknown/review_required/invalid`。

空、未知、失败均不能转换为 `false`、`0%` 或“未发现风险”。当前编码器可能将未设置的 `assessment` 展开为全零对象，旧版本也可能没有该键；两种情况都必须兼容。

## 4. 已适配的 GoPlus 字段

下表表示**代码能解析并用于评估**，不表示当前账号、链或每个代币一定返回这些字段。客户端消费标准 `items/checks`，不直接依赖供应商原始结构。

### 4.1 EVM

| 原始字段 / 条件 | 本次分级 |
|---|---|
| `is_honeypot`、`cannot_buy`、`is_airdrop_scam`、`fake_token.value`、`gas_abuse` 阳性 | R5 |
| `is_open_source=0` | R4，表示未取得可验证源码，不直接断言源码一定闭源 |
| `is_mintable`、`transfer_pausable`、`owner_change_balance`、`is_blacklisted` | 阳性 R4 |
| `hidden_owner`、`can_take_back_ownership`、`cannot_sell_all`、`selfdestruct`、`personal_slippage_modifiable` | 阳性 R4 |
| `honeypot_with_same_creator>0` | R4，并返回关联数量 |
| `is_whitelisted`、`slippage_modifiable`、`is_proxy`、`external_call` | 阳性 R2 |
| `is_anti_whale`、`anti_whale_modifiable`、`trading_cooldown` | 阳性 R2 |
| `buy_tax`、`sell_tax`、已返回的 `transfer_tax` | 按下述税费档位；各自判断，不相加 |

有效 EVM 税费：`0%` 不产生税费风险原因；`0<t<5%` 为 R2；`5%≤t<20%` 为 R3；`20%≤t≤100%` 为 R5。恰好 5% 为 R3，恰好 20% 为 R5。

不能可靠检测时，不硬套档位。例如因无法买入而形成的歧义 100% 买入税、冷却期造成的歧义 100% 卖出税，不作为已确认税率；其他已确认风险仍独立生效。

### 4.2 B20

适配 `b20_token.b20_info.<字段>.status`：

| 字段 | 阳性分级 |
|---|---|
| `mintable、transfer_pausable、owner_change_balance、blacklist、whitelist` | R4 |
| `cannot_sell、cannot_buy` | R5 |
| `metadata_modifiable` | R2 |

供应商声明 `is_b20=1` 后，相应权限检查不能因缺字段被视为完整。普通 EVM `is_whitelisted` 与 B20 `whitelist` 不是同一语义，不合并成同一个提示。

### 4.3 Solana

| 原始字段 / 条件 | 本次分级或处理 |
|---|---|
| `non_transferable` 阳性、`default_account_state=2` | R5 |
| `mintable.status、freezable.status、balance_mutable_authority.status` | 阳性 R4 |
| `default_account_state_upgradable.status` | 阳性 R4 |
| `metadata_mutable.status、closable.status、transfer_fee_upgradable.status` | 阳性 R2 |
| 有效 `transfer_hook` 程序存在 | R2 |
| `transfer_hook_upgradable.status` 阳性 | R4 |
| Hook 对应地址 `malicious_address` 阳性 | R5，与 Hook 存在/可升级归并后取有效最高档 |
| 创建者及适配权限地址的恶意标记 | R4，保留具体权限和地址证据 |
| `transfer_fee` 当前/计划费用 | 单位尚未验证，`review_required`；不套 EVM 税率规则 |

适配器包含 Ethereum、BSC、Base、Robinhood、Solana 的请求路由。**路由存在不等于供应商账号具有该链和 B20 的有效覆盖**，覆盖需部署前单独验证。

## 5. 等级与用户行为

以下限制仅在 `mode=enforce` 时执行；`observe` 只展示评估、不启用本次新的强制限制。

| 结果 | 推荐 / 关键词曝光 | 买入 | 前端展示 |
|---|---|---|---|
| 未知或检查不完整，且无已知 R4/R5 | 不获得新推荐资格 | 不因供应商未知本身禁买 | 灰色不可用/检查状态；保留已有原因 |
| R1 且检查完整 | 允许 | 普通流程 | 无风险提示条；不宣称绝对安全 |
| R2 / R3 且检查完整 | 允许 | 普通流程 | 黄色提醒 / 警告 |
| R4 | 不允许 | 明确确认后继续 | 橙色风险提示及确认弹层 |
| R5 | 不允许 | 禁止新增买入，不能确认绕过 | 红色提示，可查看原因，无继续买入按钮 |
| 内部风险存储/执行复核服务故障 | 不允许放行推荐 | 显式不可用，不能当未知放行 | 错误提示并停止本次买入推进 |

已知 R4/R5 不因字段缺失、缓存过期、供应商失败或停采而清除。Sell 不消费买入禁令，但余额、路由、合约限制和执行检查照常生效。

## 6. 新接口与前端调用顺序

### 6.1 查询风险

`GET /v1/tokens/{chain}/{address}/risk`

- 匿名可读；携带无效 JWT 仍拒绝，不降级为匿名。
- 成功信封的 `data` 为 `{chain,address,risk}`；业务成功仍须判断 `code == 200`，不能只看 HTTP 200。
- 返回当前评估，不等待 GoPlus 实时扫描；不能把该接口当作强制供应商刷新接口。

### 6.2 明确确认 R4 风险

`POST /v1/tokens/{chain}/{address}/risk/confirm`

必须用户 JWT；服务身份不能代用户确认。请求体示意如下，**占位值不是线上实测结果**：

```json
{
  "flow_id": "meme:<trade_id>",
  "confirmation_version": "<原样传入最新风险返回的confirmation_version>"
}
```

确认绑定：**用户 + 链/代币地址 + 交易流程 + 当前高风险版本**。确认不是下单授权，其他交易条件仍需通过。

### 6.3 普通 Trade

1. 买入前读取最新风险；R5 停止，R4 展示明确确认弹层。
2. 用户同意后，创建 `prepare:false` 的 pending 单，取得 `trade_id`。
3. POST 风险确认，`flow_id=meme:<trade_id>`，版本原样传递。
4. 确认成功后，调用原有 Prepare → 签名 → Submit。
5. 后端在执行及首次广播前再次复核。若变成 R5 或旧确认失效，停止推进。

Prepare/Submit 不增加客户端 `confirmed=true` 等绕过字段。网络异常后先查已有交易状态；不能自动确认、自动重签或盲目再建单。

### 6.4 FastSwap

先固定 `client_intent_id`；R4 用 `fastswap:<client_intent_id>` 确认，再 Create。创建、准备、服务端广播、垫资路径均有后端检查。

交易方向根据实际资产判定，不能通过将 `side` 改为 `sell/swap` 绕过。只有真实非现金资产换回配置现金资产、且未显式声明 buy 的退出才按独立卖出处理。

FastSwap 客户端页面仍待接入；本段是其已实现的后端对接要求，不是 UI 已完成声明。

### 6.5 错误码

| 业务码 | 含义 | 客户端动作 |
|---|---|---|
| `430310` | 需要 R4 确认 | 停止推进，获取风险并请用户明确确认 |
| `430311` | 买入被禁止 | 展示原因，不提供确认绕过 |
| `430312` | 确认版本已变化 | 重新取风险，重新让用户决定；不自动确认 |
| `400302` | 风险接口身份不允许 | 检查用户身份与接口调用方式 |
| `500310` | 风险存储/复核不可用 | 停止本次推进，按实际订单状态恢复，不能按未知放行 |

内部 `CheckTokenRisk` 无公共 HTTP 入口，由后端用于执行时检查。

## 7. 风险更新、过期与交易恢复

- 失败不刷新成功观测时间，也不清除已知阳性。
- GoPlus 解除或降低风险，需要同来源、同字段、同作用域且时间有效的明确复核；另一权限、另一地址或另一供应商的阴性不能替代。
- Hook 恶意证据解除后，可按剩余证据 R5→R4→R2；仍有其他恶意地址或无法识别的旧证据时保持限制。
- 历史 Codex 阳性目前保守保留，没有自动解除或人工更正端点。
- `confirmation_version` 包含高风险语义与单调修订号：R4→R5→相同 R4 不会复活旧确认；低等级提醒、排序、普通时间刷新不反复要求确认。
- 到达 `valid_until_ms` 后，前端不继续把旧 R1 显示为完整检查；已有 R2—R5、原因及确认身份不因过期而消失。
- 已接收签名、预计算哈希不等于已广播，首次真正广播仍复核。已广播/不确定的交易保留事实与跟踪，不伪造取消，也不重复出手。
- FastSwap 客户端自报 `broadcast_attempt` 不能授权后端为受限新买入广播或垫资。

## 8. 数据库、配置与上线要求

新增迁移：`021_token_security.sql`（证据/观测/预算）、`022_token_risk_confirmation.sql`（确认）、`023_token_risk_revision.sql`（单调修订）。风险存储独立于行情缓存。

| 配置 | 作用 |
|---|---|
| `goplus.endpoint` | 采集端点；留空停止新采集，保留已有风险 |
| `goplus.access_token` | GoPlus Console 凭据；不等于内部服务 JWT |
| `goplus.enforce` | 是否启用统一限制；示例默认 false |
| `goplus.requests_per_minute/day/month` | 跨副本请求预算，不是供应商 CU 额度 |
| `goplus.refresh_seconds / demand_seconds` | 刷新节奏和活跃需求窗口 |
| `upstream.token_data_service_token` | Trade/FastSwap 后台复核用服务 JWT，按允许服务身份签发 |

真实资金运行形态在启动时验证 TokenData 客户端、服务 JWT 的签名、有效期和身份；缺失或错误不能启动。GoPlus 凭据和服务 JWT 均需按现有密钥流程配置，文档不包含真实凭据。

建议上线次序：TokenData/迁移 → Business、Trade、FastSwap → 客户端 → observe 预热核对覆盖/误伤/预算 → 验收后开启 enforce。未知不推荐，开启前须检查候选池，避免因覆盖不足导致空榜。

停采不能等同解除限制：清空采集 endpoint 后仍保留 enforce 和风险证据。回滚不能靠清库、清缓存或退回不识别风险的旧资金服务来解除禁买。

## 9. 本轮验证结果

以下是本次实现阶段已执行的验证记录，不是本文件创建时重新执行的线上验收。

| 验证 | 结果 |
|---|---|
| 后端全量编译 | 通过；最后保留等级修复后 TokenData 再编译通过 |
| 风险、采集、榜单/搜索、服务、Social、契约 | 相关包竞态回归通过 |
| Trade/FastSwap | 12 个相关包竞态回归通过，含真实 PostgreSQL 用例 |
| 风险持久化与确认 | 真实 PostgreSQL 回归通过，覆盖绑定、版本失效、缓存过期、预算和风险保留 |
| 前端 | 493 项通过、1 项既有 smoke 跳过；类型检查、生产构建通过 |
| 移动端 UI | fixture 验证 R4 长列表固定操作区、R5 无继续买入入口；未连接钱包 |
| 独立代码复审 | 本轮发现的绕过、恢复广播漏检、旧确认复活、混合证据误禁买等问题已修复并复核 |
| 后端全量测试 | 非全绿：最终全量运行仍有基线已有迁移编号、未跟踪本地配置缺失及文档断链失败，未混入本次修改 |
| 已部署环境 / 真资金端到端 | 未执行，不得作为已通过项 |

## 10. 尚未完成及交付边界

1. **发布独立追踪**：实现验收快照不构成上线证明；提交、推送、部署及线上验收以[发布状态跟踪](./goplus-release-status.md)为准。示例默认未开启 enforce，线上状态须另行核验。
2. **供应商实权未验收**：实际账号 CU、链覆盖、B20 权限、批量权益、令牌轮换及月成本仍需核验。适配代码不构成采购或覆盖承诺。
3. **Solana 税费待校准**：原始费率单位和样本未验证，不提供猜测百分比。
4. **FastSwap UI 待接入**：后端已完成，当前隔离前端基线无该页面；未覆盖原工作区的未提交实现。
5. **人工更正未实现**：没有风险例外/解除管理端点；历史 Codex 阳性无自动清除。
6. **无新增社区认证或路由承诺**：不把风险未命中当作 Community verified，也不以本次更新宣称最佳交易路由。

## 11. 对接依据与交付位置

本文是用户要求的独立更新说明，不替代仓库中的长期接口契约。后续接口变化以同步更新的 proto、实现和主契约为准。

- [后端风险主契约](https://github.com/smartx-mafia/smartx-backend/blob/master/docs/contracts/market.md)
- [机器可读 OpenAPI](https://github.com/smartx-mafia/smartx-backend/blob/master/docs/contracts/market.openapi.json)
- [公共 TokenRisk 协议](https://github.com/smartx-mafia/smartx-backend/blob/master/api/common/v1/token_risk.proto)
- [发布与回退说明](https://github.com/smartx-mafia/smartx-backend/blob/master/docs/ops/market-data.md)
- [前端实现交接](https://github.com/smartx-mafia/fomo-research-fe/blob/main/docs/goplus-frontend-handoff.md)
- [剩余工作计划](https://github.com/smartx-mafia/smartx-backend/blob/master/docs/plan/goplus-token-risk.md)

后端工作分支：`codex/goplus-token-risk`；前端工作分支：`codex/goplus-enforcement`。以上链接指向后端 `master` 与前端 `main` 的交付位置；相应文件与更新仅在对应提交推送到目标分支后可见，链接存在不表示已部署。
