# SmartX Fast Swap：App 端后端接入手册

适用：React Native App，也适用于独立 iOS、Android 或其他客户端。

接口版本：`fast-swap.v1`，路径前缀：`/v2/swaps`。

核验日期：2026-09-17。核验后端代码版本：`79098cdfad786e41236c1697c915b73d6344fa63`。

本文直接交付 App 开发团队使用，不要求访问、运行或移植现有 Web 工程。代码示例中的 `<...>` 是占位符，非可直接使用的签名或账户信息。SDK 适配示例明确区分协议要求与待 App 项目验证的实现。

## 1. 先理解 App 与后端的分工

| 环节 | App 负责 | SmartX 后端负责 |
|---|---|---|
| 账户 | 保持 SmartX 登录与 Privy 登录；选择当前用户钱包 | 验证业务身份、钱包归属和钱包链 |
| 输入 | 买卖方向、资产、金额、滑点 | 校验参数、能力和交易约束 |
| 展示报价 | 请求并显示预计到账、最低到账和费用 | 查询定价，返回展示报价 |
| 准备交易 | 提交不可变意图，接收可签版本 | 取得可执行报价、构建交易、平台预签、资源预留 |
| 签名 | 校验版本，调用当前用户 Privy 钱包签名 | 签后再次校验内容和签名 |
| 广播 | 上传签名产物 | Solana gateway 广播；EVM 经结算方执行 |
| 状态 | WS/REST 跟进，显示到账和完成，保存恢复信息 | 观察链、Relay、账务，生成权威状态 |
| 恢复 | 重启/断网后恢复同一笔 | 幂等、防重复执行、返回快照 |

当前接入模式是：**后端组装，App 签名，后端广播**。App 不需要自己调用 Relay quote、Relay execute、Jito 或 bundler；不能将 Privy 的 `signAndSendTransaction`/`eth_sendTransaction` 直接代替签名上传，否则绕过当前广播与恢复协议。

“用户无 gas”表示用户无需预先持有原生 gas 币，不代表兑换免费。费用可能从到账资产中扣除；以报价/真实版本中费用的资产与付款方为准。

## 2. 接入前需要准备的配置和账户

### 2.1 环境配置

| 配置 | 当前测试值/来源 | 用途 |
|---|---|---|
| `FAST_SWAP_BASE_URL` | `https://sm-test-api.smartx.io`，最终以部署环境文档为准 | HTTP 与相对 WS 地址的解析基准 |
| 业务登录 token | App 已有 SmartX 登录流程取得 | 请求 SmartX API 的 Bearer JWT |
| Privy App/Client 配置 | 与后端钱包所属 Privy 应用一致 | 用户登录与客户端钱包签名 |
| Solana RPC | 项目为 App 配置的可信 RPC | 签名前读取块高与核验地址表 |
| 支持的链配置 | capabilities 与项目链配置 | EVM chainId、RPC、浏览器链接 |

不要把测试域名写死在业务代码。生产地址、Privy 配置、RPC 配额与来源策略独立配置。后端内部监听端口不是 App 的公网地址。

业务 token 和 Privy access token 用途不同：调用 `/v2/swaps` 使用 SmartX JWT，不是随便拿一枚 Privy token 替代。如何从 Privy 登录换取 SmartX 业务会话属于账户域；若 App 尚未接入，先完成账户域文档，不在本协议中发明新的登录端点。

### 2.2 钱包 ID 从哪里来

App 从已登录用户的 Privy embedded wallet 信息中取得真实 wallet ID 和地址。`wallet_id` 不是 EVM 地址、Solana 公钥或 SmartX user ID。

- 当前交易仅使用正确账户下的 embedded wallet，不用外接钱包替代。
- 源链 Solana 选择 Solana wallet；源链 EVM 选择 Ethereum family wallet。
- 一个 Privy EVM wallet ID 可以用于多个 EVM 链；本地索引不要只按 wallet ID 保存唯一链。
- 同族多个钱包时，按产品指定与后端一致的选择规则选择；当前服务端优先最小显式 wallet_index。不能直接用数组第一个元素作为跨平台可靠规则。
- 收到可签版本后，必须再次按版本里的 signer address 找到对应的本地钱包。找不到时停止，不能换另一钱包尝试。

App 所有异步任务、缓存、恢复记录绑定当前业务账户和 Privy 用户上下文。切换账户时立即隔离旧数据；旧签名即使迟到也不能在新账户下提交。

### 2.3 链与买卖方向

| 链 | API chain 值 |
|---|---|
| Solana | `solana:mainnet` |
| BSC | `eip155:56` |
| Base | `eip155:8453` |
| Ethereum | `eip155:1` |
| Robinhood | `eip155:4663` |

| App 产品操作 | origin | destination | `side` |
|---|---|---|---:|
| 买 Solana 代币 | Solana USDC | Solana token | 1（BUY），且能力表存在 |
| 卖 Solana 代币 | Solana token | Solana USDC | 3（SWAP），且能力表存在 |
| 买 EVM 代币 | Solana USDC | 对应 EVM 链 token | 1（BUY） |
| 卖 EVM 代币 | 对应 EVM 链 token | Solana USDC | 2（SELL） |

以 `origin_chain + destination_chain + side` 精确匹配 capabilities。不要以产品按钮文字直接推断协议枚举：当前 Solana 产品上的“卖出”通过 SWAP 表达；Solana source + SELL 当前不在开放范围。

USDC/mint/合约地址由业务资产目录或明确配置提供，接口不接受 symbol。金额精度来自可信资产元数据，真实版本再使用 `revision.assets` 复核。

## 3. 完整调用顺序

### 3.1 打开交易面板

1. 确认业务会话、Privy 会话及钱包 ready。
2. 读取本账户本地未决记录，调用 `GET /v2/swaps/active` 分页恢复未完成交易。
3. 调用 `GET /v2/swaps/capabilities`，只启用支持的路线、签名方式与广播方式。
4. 加载资产元数据和源钱包可花余额。注意：swap availability 接口查询的是目的资产，不能用它替代首次下单的源余额接口。
5. 无本账户签名/提交未决时，允许输入和准备新交易。

### 3.2 输入与报价

用户输入完成后防抖请求 `POST /v2/swaps/quote`。该接口只有价格，没有可签交易。输入发生变化时，使旧报价失效，晚到响应必须按请求序号和参数指纹丢弃。

当前后端 quote/Create/refresh 共用身份级限流：1 次/秒，突发 10 次。建议 App 输入防抖 300–500 ms、同账户请求限频；展示刷新例如 5 秒一次，App 进入后台停止。周期是 App 策略，不是服务端承诺。交易动作优先于展示刷新。

### 3.3 用户下单 → 签名 → 上报

```text
用户确认买卖意图
  → 保存 client_intent_id、Create key、原始请求
  → POST /v2/swaps
  → PREPARING：等待事件/快照；READY：进入签名校验
  → 显示/复核真实最低到账、费用、签名请求
  → 保存本次签名尝试标记，获取账户级签名锁
  → Privy 签名，验证签名结果
  → 可靠保存完整产物 signed_unsent
  → 可靠保存 submission_unknown 标记
  → POST /v2/swaps/{swap_id}/executions
  → ACCEPTED/REPORTED/UNKNOWN：继续观察同一笔
  → 目的链 observed/confirmed → accounting posted → outcome completed
```

App 可以使用单次 Buy/Sell 点击授权，或使用确认面板。协议不要求固定点击次数。单次点击后若重新得到的费用/最小到账超出用户确认范围，必须展示变化并重新确认，不能因用户之前看过展示价就默认接受任意新价格。

当前契约建议输入阶段用 `/quote`，用户下单时才 Create；因此首次点击到发送会包含构建时间。若 App 采用确认面板，可在进入面板时 Create，最终确认后签名。计时必须同时记录两个点击，不能隐藏首次点击后的等待。

### 3.4 不要混淆两类“报价”

| 对比 | `/quote` 展示价 | Create/refresh 的 revision |
|---|---|---|
| 是否创建 swap、锁钱包、占资源 | 否 | 是 |
| 是否有交易与平台预签 | 否 | 是 |
| 能否交给钱包签 | 不能 | 满足 READY 等条件时可以 |
| 用户改金额时 | 重取展示价 | 旧意图先结束，另建新意图 |
| 是否能把价格传回后端直接执行 | 不支持 | execution 使用 swap_id/revision 关联 |

若团队需要“输入即预构建，最终点击只签名”，必须与后端约定预构建资源生命周期。不能用频繁 Create 冒充无副作用询价；也不能把后端目前没有的 quote promotion 接口写进实现。

## 4. 通用 HTTP 与数据类型规则

### 4.1 请求头

```http
Authorization: Bearer <SmartX JWT>
Content-Type: application/json
Idempotency-Key: <该操作的 UUID>
X-Request-ID: <每次 HTTP 尝试独立的请求 ID>
```

GET 无需 Idempotency-Key。POST 中 `/quote`、`/stream-tickets` 免 key，其余必带。Content-Type 在有 JSON body 时设置。traceparent 如项目已有链路追踪则按后端支持格式传递。

### 4.2 响应判断

常见成功信封（仅摘录关键字段）：

```json
{"code":200,"trace_id":"<trace>","data":{"contract_version":"fast-swap.v1"}}
```

失败信封示意：

```json
{
  "code":420603,
  "msg":"...",
  "error":"FASTSWAP_WALLET_BUSY",
  "metadata":{"recovery_action":"get_snapshot","retryable":"false","related_swap_id":"<existing swap>"},
  "trace_id":"<trace>",
  "data":null
}
```

metadata 只展示可能字段，不保证每次齐全。HTTP 200 不代表业务成功，必须读 `code`。网关、CORS、请求体超限可能返回裸 403/413/5xx，没有业务信封；解析失败视为传输结果未知，不当成功。

每次响应检查 `data.contract_version`。字段名使用 snake_case，枚举是数字。所有请求记录自己的 trace，不使用并发事件轮询的“最新 trace”关联 execution。

### 4.3 精度与空值

- 金额 raw、revision、event_version、block/slot、EVM nonce 用字符串；比较/计算使用任意精度整数。
- RN/JS 不使用 `Number(raw)`，也不能 `parseFloat(input) * 10**decimals`。
- 用户输入 `2` USDC，在已知 decimals=6 时才转换为 `"2000000"`。
- EVM 18 位币的百分比卖出使用 BigInt 整数除法向下取整。
- `null` 表示缺失/未知，`"0"` 表示确定为零，两者不同。
- 未选中的 oneof 和未设置 optional 可以为 null；未设置普通 message 可展开为全零对象。
- `revision` 是对象不等于可签，判断见第 7 节。
- 后端某些元数据异常会拒绝整版；App 不能用 6/18/0 填补未知精度。合法 0 位精度在 App 模型中必须与缺失区分。

## 5. 全部端点速查

所有响应 data 均含 `contract_version`，下表只列其余主要字段。

| 方法/路径 | 输入 | data | 时机 |
|---|---|---|---|
| GET `/v2/swaps/capabilities` | 无 | routes、server_time | 启动/恢复/能力变化 |
| POST `/v2/swaps/quote` | 展示意图 | route_id、signing_kind、assets、预计/最低到账、fees、estimate、quoted_at | 输入阶段 |
| POST `/v2/swaps` | CreateIntent | swap | 明确下单/进入确认准备 |
| GET `/v2/swaps/{id}` | 路径 id | swap | 恢复/补全快照 |
| POST `/v2/swaps/{id}/refresh` | expected_revision | swap | 未签名版本过期 |
| POST `/v2/swaps/{id}/cancel` | expected_revision | swap | 放弃准备 |
| POST `/v2/swaps/{id}/executions` | revision、intent_hash、签名产物 | swap | 签名可靠保存后 |
| GET `/v2/swaps/active?cursor=&limit=20` | 不透明 cursor、limit | items、next_cursor | 账户恢复，逐页直到 null |
| GET `/v2/swaps/{id}/events?after_version=0` | 版本字符串 | items、next_version、reset_required | 事件补偿 |
| GET `/v2/swaps/{id}/availability` | id | availability | 查询目的资产可花 |
| POST `/v2/swaps/stream-tickets` | `{}` | ticket、expires_at、websocket_url | 每次 WS 连接前 |
| WS `/v2/swaps/stream` | ticket 首帧与订阅 | 专用 JSON 帧 | 实时进度 |
| POST `/v2/swaps/telemetry` | events[] | accepted_count、rejected_count | 异步上报性能 |

没有单独的客户端 `/authorize`、`/fast-fill`、`/broadcast` 步骤。不要照 FOMO 私有 API 名称调用 SmartX。Fast Fill 是否启用由服务端能力和快照决定。

## 6. 接口请求、响应字段与使用方法

### 6.1 capabilities

`data.routes[]` 每项：

| 字段 | 类型 | 消费方式 |
|---|---|---|
| route_id | string | 服务端路线标识，日志/埋点使用，不自行解析推导能力 |
| origin_chain / destination_chain | string | 精确匹配两侧链 |
| side | number | 与产品映射后的方向一致 |
| enabled | boolean | false 或缺席路线禁止交易 |
| signing_kinds | number[] | 仅开放 App 已实现并验收的种类 |
| broadcast_modes | number[] | 本期只接 1=GATEWAY |
| sponsorship_available | boolean | 当前代付路径是否具备条件 |
| fast_fill_available | boolean | 可能启用垫付，不保证本笔使用 |
| multi_revision_safe | boolean | 当前 false，禁止持有多版可签交易择一执行 |
| unavailable_reason | string/null | 不可用原因 |

`data.server_time` 为 RFC3339 UTC，可辅助校准设备时间。READY 的签名窗口优先使用本次回包的剩余毫秒数。

### 6.2 展示报价 `/quote`

请求字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| origin_chain / destination_chain | string | 第 2.3 节标识 |
| origin_asset / destination_asset | string | mint/合约地址，不能是 SOL/PONS 等 symbol |
| amount_in_raw | string | 精确投入原子整数，必须 >0 |
| slippage_bps | number | 整数基点，100=1%；按用户设置与服务端上限 |
| side | number | 1 BUY / 2 SELL / 3 SWAP |
| source_wallet_id / destination_wallet_id | string | 当前用户钱包 ID，后端推导地址 |
| fee_policy | number | 当前 1=PLATFORM_SPONSORED |

请求示例：

```json
{
  "origin_chain":"solana:mainnet",
  "destination_chain":"eip155:4663",
  "origin_asset":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "destination_asset":"0x39dbed3a2bd333467115de45665cc57f813c4571",
  "amount_in_raw":"2000000",
  "slippage_bps":300,
  "side":1,
  "source_wallet_id":"<solana wallet id>",
  "destination_wallet_id":"<evm wallet id>",
  "fee_policy":1
}
```

响应 data 字段：

| 字段 | 类型 | 用法 |
|---|---|---|
| contract_version | string | 必须认识 |
| route_id / signing_kind | string / number | 路线与将来的签名种类 |
| assets.origin / assets.destination | `{chain,address,decimals}` | 显示金额并核对请求资产 |
| expected_out_raw | string | 预计到手 |
| min_out_raw | string | 展示最低到手，不是可提交的交易 |
| estimate | boolean | true 时 min_out 为估算，UI 标“约” |
| fees | Fee[] | 展示费用，可能不包含组装后才知道的租金/tip |
| quoted_at | UTC string | 本次定价时间；没有承诺一个可执行 TTL |

本接口不返回 swap_id、revision、relay_request_id 或签名材料；通过它不代表 Create 必定成功。展示价缓存可以复用显示，不能缓存签名授权。

### 6.3 Create `/v2/swaps`

请求为上面的字段加 `client_intent_id`，使用独立 Idempotency-Key：

```json
{
  "client_intent_id":"<本次意图 UUID>",
  "origin_chain":"solana:mainnet",
  "destination_chain":"eip155:4663",
  "origin_asset":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "destination_asset":"0x39dbed3a2bd333467115de45665cc57f813c4571",
  "amount_in_raw":"2000000",
  "slippage_bps":300,
  "side":1,
  "source_wallet_id":"<solana wallet id>",
  "destination_wallet_id":"<evm wallet id>",
  "fee_policy":1
}
```

不能传前端期望价格来替代后端报价；不能指定任意 recipient、spender、calldata、fee payer、Relay URL。不能对已创建意图原地修改金额、资产或滑点。

Create 返回 `data.swap`。GET/refresh/cancel/executions 返回相同 SwapReply 结构。把它统一交给同一个状态 reducer。

### 6.4 SwapSnapshot 字段说明

| 路径（相对 swap） | 类型 | 含义 |
|---|---|---|
| swap_id | string | 服务端单号，用于后续所有接口 |
| execution_group_id | string | 多 revision 归属同一执行组，App 原样保留 |
| event_version | string | 当前事件版本，同 swap 单调递增 |
| intent | CreateIntent | 不可变原始意图，用于恢复表单和复核 |
| intent_hash | string | 后端意图 hash，执行时原样上传 |
| preparation | object | 能否签名与当前 revision |
| revision | object | 当前版本与签名材料；无材料时可能是全零对象 |
| execution | object | 产物处理/广播状态 |
| settlement | object | 源链、目的链、Relay、账务与最终结果 |
| fast_fill | object | 垫付状态，不作为成交判据 |
| availability | object | 目的资产可执行观测，普通快照可能未实测 |

preparation：`status:number`、`current_revision:string|null`、`retry_after_ms:number|null`、`reason_code:string|null`。

| preparation.status | App 动作 |
|---|---|
| 1 PREPARING / 3 REFRESHING | 等待 WS/轮询，不调用 SDK |
| 2 READY | retry_after_ms 表示到 safe_sign_before 的剩余时间，完成校验才可签 |
| 4 EXPIRED | 未签名则受控 refresh 同单；已签名则恢复 |
| 5 BLOCKED + retry_after_ms | 暂时阻塞，退避后按状态重新检查/refresh |
| 5 BLOCKED + retry_after_ms 缺失 | 当前无自动重试建议；不要无限轮询准备。读取 outcome，必要时结束旧意图再修正输入 |

### 6.5 revision：用户最终要签的版本

| 字段 | 类型 | 含义 |
|---|---|---|
| revision | string | 本版序号，与 preparation.current_revision 一致 |
| intent_hash | string | 必须与 snapshot.intent_hash 一致 |
| created_at | UTC string | 版本生成时刻 |
| safe_sign_before | UTC string | 安全开始签名的期限 |
| safe_broadcast_before | UTC string | 签名后首次发送的安全期限 |
| quote_valid_until | UTC string | 平台定义报价期限，不替代链上期限 |
| assets | origin/destination `{chain,address,decimals}` | 本版精确资产信息 |
| expected_out_raw / min_out_raw | string | 预计到手/真实执行最低到手 |
| fees | Fee[] | 最终费用清单 |
| relay_request_id | string | 结算方关联 ID；App 不据此独立执行 Relay |
| solana / evm | object/null | 二选一的实际签名材料 |

期限满足 `safe_sign_before ≤ safe_broadcast_before ≤ quote_valid_until`。本版不可变；App 不能为了续期改 blockhash/deadline/nonce。

Fee：`{chain:string, asset:string, amount_raw:string, payer:number, kind:number}`。费用必须按自己的 asset/decimals 显示，不能用交易目标币的精度解释所有费用。总费和子项可能并列，不能直接把 fees 数组全加起来；没有明确包含关系时分项显示、不伪造总费用。

### 6.6 刷新与取消

```http
POST /v2/swaps/<swap_id>/refresh
Idempotency-Key: <本次 refresh UUID>
```

```json
{"expected_revision":"1"}
```

Cancel 路径换为 `/cancel`，body 同形。路径绑定 swap_id；App 可按协议实现同时携带与路径一致的 swap_id，不能二者冲突。还没有版本时 expected_revision 可缺席/null，已有版本时必须使用最新已知版本。

刷新得到新 revision 后重新校验；旧版被平台判过期不等于在链上失效。后端可能因为旧 blockhash/deadline 仍有效而拒绝刷新，App 此时恢复同单并等待，不新建来绕过。

取消表示停止发放新版本，不是撤回签名、更不是链上撤销。cancel_pending 可能持续到旧材料过期并完成核查。终态尚未到达时不自动创建替代交易。

## 7. 签名前的统一检查

1. 当前账户与用户确认时一致，source wallet、destination wallet 与 intent 一致。
2. preparation=READY，版本/hash 一致，恰好存在一种已支持签名材料。
3. execution=NOT_REPORTED，且本地没有本单/本账户签名或发送未决。
4. 当前表单与 intent 完整一致；用户确认的最低到账/最高费用约束仍满足。
5. 签名窗口足够，App 当前在前台，没有 refresh/cancel 等变更在途。
6. 交易材料验证通过；查得到对应本地 signer。
7. 原子获取签名锁，重复点击、重渲染、导航返回、推送回调不会启动第二次。

以本次网络请求接收点的单调时钟锚定 TTL，可保守扣除网络耗时；同版本重放不能重新延长倒计时。手机从后台恢复或进程重启后先 GET 同单重建时钟，不能把之前 JS runtime 的 performance.now() 沿用到新进程。

## 8. Solana 签名接入

### 8.1 签名材料字段

`revision.solana`：

| 字段 | 类型 | 用法 |
|---|---|---|
| kind | number | 1=SOLANA_TRANSACTION |
| transaction_base64 | string | 平台已签、用户待签的完整交易 |
| message_hash | string | SHA-256(message bytes)，小写 hex |
| fee_payer_address | string | 平台代付地址，不能替换 |
| user_signer_address | string | 本地必须使用的用户钱包公钥 |
| blockhash | string | 已在原 message 中，不重新获取替换 |
| last_valid_block_height | string | 链上过期高度 |
| lookup_tables | `{address,addresses[],last_extended_slot,observed_slot}`[] | 用可信 RPC/缓存核验地址展开表 |
| execution_guard | `{program_id,group_id}` | 当前保守模式 program_id 可为空，不擅自添加程序 |
| broadcast | `{mode,endpoint_id,backup_endpoint_id}` | 当前 mode=1，endpoint_id 不是 App 任意访问 URL |

### 8.2 算法

```text
transaction_base64 → 解码完整 wire transaction
→ 解析 message / signer 列表 / 原始 signatures
→ 核对 message_hash、fee payer、user signer、平台预签
→ 核对地址表与链上有效期
→ 使用指定 Privy Solana wallet 做 sign-only
→ 归一 SDK 返回值成完整已签交易
→ 比对签名前后 message 完全一致、平台签名未变化
→ 验证用户签名存在且可验证
→ serialize → Base64 → 保存 → executions
```

SDK 若返回完整已签交易就解析校验；若当前经过验证的适配返回 64 字节用户签名，只能将其放入原交易的用户 required-signer 槽，再序列化原交易。不能把裸签名作为 signed_transaction_base64 上传，不能覆盖平台槽位。

### 8.3 RN 适配边界

Privy RN 官方 quickstart 使用 `@privy-io/expo` 的 embedded wallet provider。App 应先取得选定钱包的 provider，再按**项目锁定 SDK 版本**支持的 sign-only 接口实现适配。官方示例中的 sign-and-send 不适用于本 gateway 协议。[Privy RN quickstart](https://docs.privy.io/basics/react-native/quickstart)

建议 App 自行实现如下稳定接口；这是 App 内部接口设计，不是声称 Privy SDK 存在同名函数：

```ts
interface AppWalletSigner {
  signSolanaOnly(input: {
    walletId: string;
    signerAddress: string;
    transactionBase64: string;
  }): Promise<{ signedTransactionBase64: string }>;
}
```

输入输出 Base64 边界固定，内部如何使用 VersionedTransaction、Uint8Array、Buffer 或 native bridge，由 RN SDK 类型定义决定。不要复制 Web 的 `useSignTransaction` import 到 Expo 就当作可用代码。签名语义参照 [Privy sign-only 说明](https://docs.privy.io/wallets/using-wallets/solana/sign-a-transaction)，其中展示的 React API 不能冒充 RN API。

## 9. EVM / Calibur / EIP-7702 签名接入

### 9.1 EVM 材料

`revision.evm` 包含 `kind、chain、signer_address、execution_digest、nonce、deadline、requests[]`。

- 当前主要接 `kind=2 EVM_CALIBUR`。
- nonce 是 uint256 十进制字符串；deadline 是 RFC3339 UTC，不是秒数。
- request 为 `{request_id, method, typed_data, authorization}`，最后两项二选一。
- 普通交易可能只需一次批次签名；首次委托可能再要求一项 7702。不要假定始终一项，也不要自动额外添加一项。

| method | 材料 | App 输出 |
|---|---|---|
| 1 ETH_SIGN_TYPED_DATA_V4 | typed_data：domain/types/primary_type/message | EIP-712 签名，hex |
| 2 EIP7702_AUTHORIZATION | authorization：chain_id/address/nonce，全为字符串 | 该授权的 secp256k1 签名，hex |

### 9.2 EIP-712

将协议字段 `primary_type` 转换为 SDK 的 `primaryType`，其余数据精确保留。检查 domain 的链与签名者、实现标识、nonce、deadline、executor 和可执行调用范围。独立计算 typed-data hash，与 execution_digest 比较，再交给 SDK；签后恢复地址必须匹配 signer_address。

重要兼容：后端 `google.protobuf.Struct` 在 JSON 中可能是普通对象，也可能是以下 wire 展开形态：

```json
{"fields":{"name":{"string_value":"Calibur"},"chainId":{"number_value":4663}}}
```

必须递归还原 Struct/Value/ListValue，得到 `{name:"Calibur",chainId:4663}`，再做白名单/摘要校验。不能把 `{fields:...}` 原样传 SDK。大额、nonce 若收到超安全整数的 JSON number，应拒绝并报契约错误，不能把已经丢精度的 Number 转回字符串当作修复。

调用边界：当前 Calibur 批次允许已支持的花费调用或 approve+花费；approve 目标应是本次投入币，spender 与额度需受约束。只有 canonical Permit2 的既定策略可接受无限授权，不能普遍允许任意 spender 无限额度。ERC-20 花费不能夹带意外 native value，单独 approve 不是完整兑换。

App 要维护经过核验的签名 schema/实现与调用白名单；这些是签名授权边界，不能用“字段看起来像地址”代替。集成验收应提供与后端一致的合法/非法交易夹具，对合法摘要比对、对非法内容拒签。

EVM RN provider 的获取方式有官方说明；typed-data 方法语义见 [Privy EIP-712 文档](https://docs.privy.io/wallets/using-wallets/ethereum/sign-typed-data)。具体 RN 支持方法、params 与返回形状由 App 锁定版本验证。

### 9.3 首次 EIP-7702 授权

authorization.address 是委托实现地址，**不是收款人**。chain_id 必须是本次源链，nonce 是源链账户授权用交易计数，**不是 Calibur 批次 nonce**。

后端已将对外授权字段统一为字符串，例如 `{"chain_id":"1","address":"<实现地址>","nonce":"0"}`；App 不应继续按内部旧 JSON 数字形态设计。

这项授权会改变账户的执行委托，是交易权限动作，不能用于后台预热。只能按本版材料、用户下单授权签署。

Privy 官方 7702 页面明确列出 React、REST、Node 支持，未据此确认当前 App 所用 Expo 版本支持同一 hook。因此 RN 首次授权是一个必须单独完成的 SDK 适配验收点，不能宣称 Web 成功就保证 RN 成功。[Privy 7702 文档](https://docs.privy.io/wallets/using-wallets/ethereum/sign-7702-authorization)

若 RN SDK 支持原始摘要签名，可在验证后采用等价授权摘要路径；必须签正确 EIP-7702 摘要并恢复地址验证，不能用 personal_sign 加前缀代替。若 SDK 不支持，则阻止需首次授权的路线并反馈，不跳过授权、不把 App secret 放客户端、不临时转为后端代签。

### 9.4 签名提交格式

每个请求只签一次，按 request_id 保存结果，不按数组下标猜用途。secp256k1 签名规范化为后端接受的 65 字节 hex（low-S 和恢复位按签名库一致处理），禁止手工截取不明确的返回值。

多项签名串行执行。第一项已签、第二项拒绝/超时：标记部分产物和失败阶段，不提交不完整列表，不自动换新版本补样；恢复策略需复核同版仍有效，并由用户明确继续。任何 SDK Promise 超时都不代表底层签名已经停止。

App signer 适配建议再提供 `signTypedDataOnly`、`signAuthorizationOnly`，但公开 HTTP 层只认识下面的请求产物，不依赖这些内部函数名称。

## 10. 上传签名：`POST /v2/swaps/{swap_id}/executions`

### 10.1 Solana

```json
{
  "swap_id":"<swap_id>",
  "revision":"1",
  "intent_hash":"<snapshot/revision 原值>",
  "solana_transaction":{"signed_transaction_base64":"<完整已签 wire transaction>"}
}
```

### 10.2 EVM

```json
{
  "swap_id":"<swap_id>",
  "revision":"1",
  "intent_hash":"<snapshot/revision 原值>",
  "evm_signatures":{"signatures":[
    {"request_id":"calibur_batch","signature":"<0x signature>"},
    {"request_id":"authorization_7702","signature":"<仅当本版 requests 要求>"}
  ]}
}
```

两种 artifact 只传其一；没有 authorization_7702 请求就不上传那一项。每次逻辑 execution 使用固定幂等键，网络尝试可以换 X-Request-ID，但不能随意换执行身份或产物。

响应仍是 SwapReply，重点看：

| execution.status | 意义 | App 行为 |
|---|---|---|
| 1 NOT_REPORTED | 当前快照未登记执行 | 仍需检查本地是否已签/已发送，不能据此自动重签 |
| 2 REPORTED | 已登记产物 | 跟进同单 |
| 3 ACCEPTED | 广播/执行出口已接受 | 跟进同单，不等于入块/到账 |
| 4 UNKNOWN | 广播结果不确定 | 恢复同单，禁止新签名 |
| 5 FAILED | 服务端本次出口拒绝 | 提示本次被拒；保留同单跟踪，等安全终态，不自动重签 |

服务端可能以 code=200 返回 execution=FAILED/UNKNOWN。这是“执行状态已可靠保存”，不是资金成交成功。

当前 App 没直接广播，不上传虚构 broadcast_attempt。即使接口允许它，这也只是提示，不抬高服务端对上链事实的判定。

## 11. 实时进度与最终结果

### 11.1 WebSocket

1. POST `/v2/swaps/stream-tickets`，body `{}`，业务 JWT，无幂等键。
2. 从 data 取 ticket、expires_at、websocket_url。若相对路径，以 FAST_SWAP_BASE_URL 拼接，https 改 wss；若绝对 URL，校验可信目标。
3. 打开连接后 5 秒内发送首帧，ticket 不放 URL/query：

```json
{"type":"authenticate","ticket":"<ticket>","subscriptions":[{"swap_id":"<id>","after_version":"0"}]}
```

连接后新增/移除订阅：

```json
{"type":"subscribe","subscriptions":[{"swap_id":"<id>","after_version":"12"}]}
```

```json
{"type":"unsubscribe","swap_id":"<id>"}
```

服务端帧：authenticated、event、reset_required、heartbeat、error。event 外层 type 是字符串，payload 内的 SwapEvent.type 是数字，不能混淆：

```json
{
  "type":"event",
  "swap_id":"<id>",
  "event_version":"13",
  "payload":{
    "swap_id":"<id>",
    "event_version":"13",
    "type":3,
    "occurred_at":"2026-09-17T08:00:00.000Z",
    "trace_id":"<trace>",
    "snapshot":{}
  }
}
```

示例 snapshot `{}` 仅为省略，真实事件需完整 SwapSnapshot；不可把此示例当解析夹具。

WS 不套 HTTP code/data 信封。每连接最多 20 个订阅、帧最大 8 KiB；每用户连接上限按部署配置。建议 App 账户级共享一条连接。4401 重新取票；4429 减少连接后退避；BAD_FRAME/SLOW_CONSUMER 等按协议重连/恢复。

### 11.2 版本与断线补偿

- 对 `(account, swap_id)` 维护最后采用的 event_version。
- 小于/等于已处理版本的重复事件忽略；REST 同版快照可按明确合并策略更新非冲突的可用性信息。
- 大于预期且跳号，或者 `reset_required`，GET 全量快照重新建立基线。
- 断线后取新 ticket，用最新 after_version 重订阅。
- REST events 返回 `items[]、next_version、reset_required`；reset=true 时不可继续套用不完整增量。
- WS 与 REST 共用一个 reducer，不能两套状态相互覆盖。

WS 为加速通道，REST 为补偿。推荐无 WS 时单个请求完成后约 1 秒再查，有错误再指数退避；不重叠高频请求。网络失联只能显示状态待核实，不显示失败，也不重发新交易。

### 11.3 各状态的产品含义

| 维度 | 值 | 用户含义 |
|---|---|---|
| 链腿 source/destination | 1 not_seen / 2 observed / 3 confirmed / 4 reorged | 尚未发现 / 已观察 / 满足当前后端确认条件 / 重组 |
| relay | 1 pending / 2 filled / 3 refunding / 4 refunded / 5 failed | 求解器结算进度 |
| accounting | 1 pending / 2 posted / 3 reversal_pending / 4 reversed | 业务账务进度 |
| outcome | 1 pending | 继续处理中 |
| outcome | 2 completed | 业务完成：两侧 confirmed、Relay filled、账务 posted，实际到账额存在 |
| outcome | 3 cancel_pending / 4 cancelled | 取消核实中 / 已取消 |
| outcome | 5 expired_unexecuted / 6 failed_no_debit | 未执行并过期 / 失败且未扣款 |
| outcome | 7 refunding / 8 refunded | 退款中 / 已核实退款 |
| outcome | 9 attention_required | 需要核实，仍属未决，不自动重签 |

目的资产可先到账，源链后达到确认数，这不是异常。客户端不能用线性进度假定 source confirmed 必定先于 destination observed。

`confirmed` 是后端定义的链确认阈值，不能统一宣传为链的不可逆 finality；App 不另数固定块数盖过后端结论。区块高度、tx hash、Relay filled 各自都不能单独替代 completed。

### 11.4 settlement 结果字段

| 字段 | 类型 | 用途 |
|---|---|---|
| source / destination | number | 两条链各自的观测/确认状态 |
| relay / accounting / outcome | number | 结算方、账务与总结果，见上表 |
| amount_in_actual_raw | string/null | 本单核实的实际投入，不用 intent.amount_in_raw 冒充 |
| amount_out_actual_raw | string/null | 核实的实际到账；用于成交详情和后续卖出数量 |
| amount_refunded_raw | string/null | 已核实退款数量 |
| refund_fee_delta_raw | string/null | 入金与退款差额，不能默认显示全额退款 |
| destination_tx_hash | string/null | 目的链实际 tx hash，按 destination_chain 生成链接 |
| destination_observed_at | UTC string/null | 后端首次观察到目的到账的时间 |
| destination_finalized_at | UTC string/null | 后端记录的目的确认时间，链级终局语义以服务端策略为准 |

源链交易 hash 在 `execution.origin_tx_hash`。`execution.relay_request_id`、`relay_execution_id`、`user_operation_hash` 是不同系统的标识；有 hash 只证明存在交易标识，仍需 source/destination 事实。EVM UserOperation hash 不应作为普通交易 hash 链接。

`fast_fill` 为 `status:number`、`reason_code:string|null`，只说明垫付情况。普通成功交易也可能显示 Fast Fill disabled/released，这不否定成交结果。

### 11.5 availability 与余额

GET `/v2/swaps/{id}/availability` 返回：asset、chain、wallet_id、balance_raw、reserved_raw、spendable_raw、can_execute、reason_code、observed_block、observed_at。

这些字段针对**本单目的钱包的目的资产**。普通 GET snapshot/active/部分事件中的 availability 可能只是未实测对象，can_execute=false、三个数量=null。没有 observed_at 时不得显示“余额为 0”。

在目的到账后查询一次 availability，App 回到前台或准备下一笔时重新确认。金额/钱包匹配、观测足够新才用于按钮状态；后端仍最终检查余额和资源。completed 后刷新现有账户/Portfolio API；不要用 expected_out_raw 自己写真实持仓。

## 12. 错误处理与幂等恢复

### 12.1 错误码

| code | 含义 | 处理重点 |
|---|---|---|
| 100601 | 意图非法 | 改输入，展示本地化提示 |
| 400602 | 钱包不匹配 | 检查本账户钱包与链，不枚举别人的钱包 |
| 420603 | 钱包忙 | 恢复 related_swap_id，不换 ID 绕过 |
| 430604 | 报价过期 | 未签才可 refresh；已签/可能发出先恢复 |
| 420605 | revision 冲突 | GET 最新同单快照 |
| 420606 | 幂等冲突或在途 | 必须按 recovery_action 三档处理 |
| 100607 / 100608 | 签名无效/交易内容不一致 | 停止上报，查同单状态和签名适配 |
| 500609 | 代付不可用 | 按 metadata 退避，不擅自让用户钱包付 gas |
| 430611 | 路线不可用 | 结合 metadata 和快照判断修正输入或刷新 |
| 430614 | 要求恢复 | 停普通操作，GET 同单 |
| 200616 | 资源不存在或非本人 | 不泄露他人资源，不盲建替代单 |
| 420000 | 限流 | 有界退避，交易优先于展示刷新 |
| 400000 | 会话失效 | 重登录后以原账户恢复；不转到另一账户提交 |
| 500000 / 网络错误 | 内部/传输未知 | 保留恢复上下文，先核实同单 |

500610/500612 为保留码，按通用恢复策略处理，不依赖它们必然出现。

### 12.2 metadata

字段值都是字符串：`recovery_action`、`retryable`、`retry_after_ms`、`related_swap_id`。未知 action 按 get_snapshot。

| recovery_action | App 动作 |
|---|---|
| change_input | 修正参数；已有 swap 需先确认旧单可安全结束 |
| get_snapshot | GET 同单或 related_swap_id；没有 id 则用原 Create 幂等信息找回 |
| refresh_quote | 展示阶段重 quote；有未签 swap 则受控 refresh；已签转恢复 |
| retry_same_request | 原 key、原 body，按照建议或有上限的退避重试 |
| new_idempotency_key | 持久化新 key 后重发同请求；swap/intent/revision/签名都不变 |
| contact_support | 停止重试，保留 trace 与本地记录 |

420606 的三档不能混为“重新下单”：contact_support 是 key+内容冲突，retry_same_request 是原请求还在飞，new_idempotency_key 是旧 key 不再适合重试但原产物/意图必须保持。

服务端幂等记录当前按 7 天保留，App 不把它当永不过期；长时间离线回来先读同单，不盲目发送很久以前的签名。

### 12.3 每个阶段的恢复规则

| 失败位置 | 保留内容 | 正确动作 |
|---|---|---|
| quote 请求失败 | 最新表单指纹 | 重取展示价 |
| Create 返回前断网 | client_intent_id、Create key、完整原请求 | 同 key/body 重试，不能生成新意图补样 |
| 等待 READY 被杀进程 | swap_id、revision、event_version | GET 同单、重订阅 |
| SDK 调用中退后台/超时 | 签名开始标记、attempt、版本、已完成的 EVM request | 状态未决，不自动再次调用钱包 |
| 签名已生成但保存失败 | 内存中产物与失败标记 | 重试可靠保存；保存前绝不发 execution |
| 已签未发但超过发送窗口 | signed_unsent 产物、旧版标识 | 停止发送，恢复/等待安全收尾，不改签名续期 |
| execution 超时/断网 | submission_unknown + 同一 artifact/key | GET；需要时按 metadata 重传同一产物 |
| code=200、execution UNKNOWN | swap 快照 | 只观察，不能重签 |
| execution FAILED、outcome pending | 签名及快照 | 等后端核查到安全终态 |
| cancel 超时/冲突 | 原 cancel key、expected_revision | 先 GET 结果；不能宣称已撤销 |
| 其他设备有已上报交易 | 服务端 active/snapshot | 只观察；本机没有签名不表示可以补签 |

## 13. RN 本地持久化与生命周期

### 13.1 持久化结构建议

以下是 App 内部记录，不是 HTTP 请求字段：

```ts
type PendingSwapRecord = {
  formatVersion: 1;
  accountScope: string;
  clientIntentId: string;
  createKey: string;
  intent: Record<string, unknown>;
  swapId?: string;
  revision?: string;
  intentHash?: string;
  eventVersion?: string;
  signAttemptId?: string;
  executionKey?: string;
  phase: 'creating' | 'preparing' | 'signing_unknown' |
    'partially_signed' | 'signed_unsent' | 'submission_unknown' | 'tracking';
  artifact?:
    | {kind:'solana'; signedTransactionBase64:string}
    | {kind:'evm'; signatures:{request_id:string; signature:string}[]};
  safeBroadcastBefore?: string;
  lastTraceId?: string;
  updatedAt: string;
};
```

至少按 account+swap 或 account+clientIntentId 隔离，避免一笔覆盖另一笔。首版可以每账户只允许一个未决签名，但此限制必须显式实现，不靠 UI 暂时只显示一个按钮。

### 13.2 保存顺序

1. Create 前保存 intent 和 Create key，确认写成功。
2. 调 SDK 前保存签名开始标记；崩溃回来能知道可能已有签名。
3. 签名校验后保存完整 `signed_unsent` 产物并等待提交成功。
4. 发 execution 前保存 `submission_unknown` 并等待提交成功。
5. 再发 HTTP。
6. 服务端可靠接收或安全终态后，按 account+swap+revision+executionKey 比较删除对应材料。

RN 没有浏览器 IndexedDB/sessionStorage。使用项目认可的可靠事务存储，签名产物应加密保存，可将加密密钥放平台安全存储；不要假定异步存储函数返回就具备需要的崩溃恢复保证，应通过杀进程测试验证。恢复读取“无记录”“读取失败”“损坏记录”必须是三种不同结果。

签名可以直接用于执行，不放到日志、崩溃上传、analytics 或明文剪贴板。客户端不保存私钥/助记词；Privy 会话按 SDK 管理。

### 13.3 AppState、导航与网络

- 导航切换不能重新挂载整个钱包 Provider；交易管理器独立于交易 Screen。
- AppState 进入后台：停止展示报价/新签名；允许系统中断网络，但保存未决上下文。不要依赖后台 JS 定时器持续运行。
- 回前台：核对账户、网络、token，读取恢复记录，GET 同单，再建立 WS。
- 移动网络/Wi-Fi 切换：WS 重连取新 ticket，execution 超时走结果未知恢复。
- Face ID/密码/钱包弹窗等待单列计时；切到系统授权界面不等于用户取消交易。
- 进程被杀后 performance.now() 已改变，只恢复业务身份与状态，不恢复旧单调时钟计算。
- SDK 返回迟到签名：校验账户、sign_attempt、revision 仍属于原上下文；不能在当前新页面自动广播。

## 14. 预热是可选优化，不是接通交易的前提

先验证 sign-only、可靠落盘、幂等上报和状态恢复，再引入预热。App 首批可在交易面板可见时准备已登录会话与 wallet provider，并与展示报价并行。

不要在每次输入/每次 render 都运行预热；按账户、钱包、链、Provider 生命周期去重。正在签名/上报/恢复时不能并发预热签名。

已有 Web 实验中的 Solana 非授权消息签名预热不能被自动当作 RN 必需步骤或官方保证。若 App 单独实验，应明确用户体验、避免弹窗、只签带用途标记的非授权消息、丢弃结果、保留实验开关，并确保与正式签名串行。严禁用交易、token approve、7702 授权做预热。

SDK 没有取消能力时，timeout 只代表 App 不再等待，不证明底层已经停止。不要超时后立即放行另一笔钱包签名。

历史 Web 0.6 秒等结果不能作为 RN 耗时承诺。App 需要在真实 iOS/Android、锁定 SDK、Release 构建、相同网络和账户模式下独立测量。

## 15. 埋点：从用户点击到真正完成

### 15.1 本地事件

每个事件关联 experiment_id、App build、SDK version、OS、运行模式、account scope、client_intent_id、swap_id、revision、sign_attempt_id、HTTP attempt_id/trace_id。

| 事件 | 定义 |
|---|---|
| input_changed / quote_start / quote_done | 输入到展示报价 |
| order_click / create_start / create_done / ready_received | 用户开始下单到版本就绪 |
| confirm_click（若有二次确认） | 最终确认签名，不代替 order_click |
| wallet_prepare_start/done | 会话/provider 准备 |
| sign_precheck_start/done | 签前校验 |
| privy_sign_start/done/error | 按 request_id 逐次 SDK 调用 |
| sign_postcheck_done / serialize_done | 验签及编码 |
| artifact_saved / submission_unknown_saved | 两次可靠落盘完成 |
| execution_request_start / headers / body_done / parse_done | 每次 HTTP 分段 |
| execution_accepted | 首次收到 accepted |
| source_observed/confirmed | 首次收到源链事实 |
| destination_observed/confirmed | 首次收到目的链事实 |
| accounting_posted / completed | 首次收到账务完成/总完成 |
| app_background/foreground / recovery_start/done | 生命周期和恢复 |

必须汇总：order_click→completed、confirm_click→execution、Privy 每项/总签名、HTTP 耗时、目的链到账、最终 completed、失败阶段和是否已产生签名。

时间全部用当前进程单调时钟计算；服务端事件 UTC 与区块秒级时间分开列。reported 事件时间不是请求最早到达网关的时间；需要服务端接收点就另取相同 trace 的服务端记录。

不要把多条并发请求耗时简单相加；SDK 总耗时减去已测网络覆盖后的余量只能称未归因，不直接称加密计算。RN 跨 native/JS clock 不对齐时不能相减。

### 15.2 `/telemetry` 示例

```json
{
  "events":[{
    "client_attempt_id":"<attempt uuid>",
    "swap_id":"<swap id>",
    "revision":"1",
    "name":"sign_ms",
    "monotonic_ms":"650",
    "wall_time":"2026-09-17T08:00:00.000Z",
    "attributes":{"route":"<route id>","wallet_type":"embedded_solana","cold_start":"false","channel":"gateway"}
  }]
}
```

monotonic_ms 按 proto int64 采用十进制字符串，表示这一指标的单调时间耗时。白名单 attributes 为 route、wallet_type、cold_start、channel、error_class；键值使用短 ASCII 枚举。未知键会丢弃计数；诊断详细上下文另存脱敏证据，不能向此接口任意塞参数。

埋点批量异步发送并带幂等键，不阻塞签名/发送。失败不影响业务状态。正式签名产物的可靠保存不能被“埋点异步优化”一起延后。

## 16. 枚举全集速查

线上传数字，0 均为未指定/未知。未来不认识的枚举禁止签名，状态显示未知并保留恢复。

| 枚举 | 值 |
|---|---|
| Side | 1 BUY，2 SELL，3 SWAP |
| FeePolicy | 1 PLATFORM_SPONSORED |
| PreparationStatus | 1 PREPARING，2 READY，3 REFRESHING，4 EXPIRED，5 BLOCKED |
| ExecutionStatus | 1 NOT_REPORTED，2 REPORTED，3 ACCEPTED，4 UNKNOWN，5 FAILED |
| ChainLegStatus | 1 NOT_SEEN，2 OBSERVED，3 CONFIRMED，4 REORGED |
| RelayStatus | 1 PENDING，2 FILLED，3 REFUNDING，4 REFUNDED，5 FAILED |
| AccountingStatus | 1 PENDING，2 POSTED，3 REVERSAL_PENDING，4 REVERSED |
| Outcome | 1 PENDING，2 COMPLETED，3 CANCEL_PENDING，4 CANCELLED，5 EXPIRED_UNEXECUTED，6 FAILED_NO_DEBIT，7 REFUNDING，8 REFUNDED，9 ATTENTION_REQUIRED |
| SigningKind | 1 SOLANA_TRANSACTION，2 EVM_CALIBUR，3 EVM_PERMIT（当前 App 不默认开放） |
| EvmSigningMethod | 1 ETH_SIGN_TYPED_DATA_V4，2 EIP7702_AUTHORIZATION |
| BroadcastMode | 1 GATEWAY，2 JITO_DIRECT（当前不默认开放） |
| BroadcastResult | 1 ACCEPTED，2 UNKNOWN，3 REJECTED |
| FeePayer | 1 USER，2 PLATFORM |
| FeeKind | 1 PLATFORM，2 RELAY，3 GAS，4 RENT，5 TIP |
| SwapEventType | 1 PREPARATION_UPDATED，2 EXECUTION_UPDATED，3 SETTLEMENT_UPDATED，4 AVAILABILITY_UPDATED，5 RESET_REQUIRED（保留，当前以独立帧/REST bool 表达） |
| FastFillStatus | 1 DISABLED，2 ELIGIBLE，3 REQUESTED，4 ACCEPTED，5 UNKNOWN，6 REJECTED，7 RELEASED，8 LOSS |

## 17. App 交付验收清单

### 17.1 首先打通三种签名路径

1. Solana transaction：平台预签保留、用户只补签、后端 gateway 广播。
2. 已委托 EVM：单项 Calibur typed-data，request_id 正确提交。
3. 首次 EVM：Calibur + 7702；两项均支持、摘要一致、部分失败可恢复。只通过第 2 项不能宣布 EVM 全部完成。

### 17.2 失败注入

- Create 发送后断网，恢复得到同一个 swap。
- SDK 调用中退后台/锁屏/杀进程，不产生另一次自动签名。
- 第一项 EVM 签名完成后第二项拒绝，保留 partial 状态。
- 两次持久化分别失败时都不广播。
- execution 已发但 response 丢失，恢复同 artifact，不新增订单。
- quote/refresh 的过期响应、重复点击、多 Screen 竞争只生效一次。
- WS 断开、跳号、reset、token 过期，REST 能恢复。
- 目的先到账、source 未确认时不提前 completed。
- 未实测余额、退款差额缺失、reorg 不被当作零值或成功。
- 切账号不能显示或发送旧账号的签名和交易。
- 签名不进日志/崩溃报告；trace 可定位每个请求。

### 17.3 五链验收

每链每方向单独列状态：能力已声明、quote 通过、Create 可签、SDK 签名成功、execution 接受、链上回执成功、实际扣款/到账一致、账务 completed。不能将报价通过写成交易通过。

Solana 同链小额零 app fee 的新规则已在本文核验的后端版本实现；仍需 App 真实卖出验收。App 不需要添加收费豁免请求字段，更不能全局忽略费用校验。

每笔实际测试记录：输入 raw、实扣 raw、实收 raw、swap/revision/trace、两条链 hash/区块/时间、每个 App 时间点、结果与错误。统计逐笔值、中位数和范围；少量样本不声称稳定 P95。

冻结前后端版本/SDK/设备/网络/构建模式。结果未知恢复原单；不偷偷补样。前后台人工等待分别列出。版本更换后单独开启新实验批次。

## 18. 实施顺序与交付物

| 阶段 | App 团队输出 | 联调通过条件 |
|---|---|---|
| 1 HTTP/DTO | 通用 envelope、精度/枚举解析、capabilities、quote | token 正确、错误可读、展示不建单 |
| 2 创建/状态 | Create/GET/refresh/cancel、不可变意图与版本管理 | READY 与安全窗口准确，重复请求幂等 |
| 3 Privy adapter | RN sign-only 三种路径与签后验证 | 无直接广播、平台签名保留、7702 支持已证实 |
| 4 恢复存储 | 事务持久化、签名锁、生命周期恢复 | 断网/杀进程不重复资金动作 |
| 5 execution/WS | 签名上报、共享 WS、REST 补偿 | 事件一致、未知状态可恢复 |
| 6 结果 UI | 多维状态、实际到账、费用、退款、Portfolio 刷新 | 到账、可用、入账分别正确 |
| 7 性能/验收 | 每笔证据、Release 真机五链报告 | 完整资金与状态核对，无未归因的“成功” |
| 8 灰度 | 按账户/链/方向开关、旧单恢复保留 | 停新单不丢正在处理的交易 |

最终 App 接入交付：接口封装和 DTO、Privy adapter、恢复模块、状态订阅模块、UI 映射、失败用例、十笔实测记录、灰度开关。实现可以自由组织模块，不依赖既有 Web 组件或文件路径。

## 19. 上线规则与当前需要团队对齐的事项

- App 团队提供已锁定的 `@privy-io/expo`/RN/Hermes 版本，以及 Solana sign-only、EIP-712、首次 7702 三项可用性结果。本文不指定未经验证的 SDK 调用签名。
- 后端提供部署版本和公网地址；灰度仅开放客户端已实现且实际验收过的 route。
- 前端与后端确认费用总项/子项关系、默认资金资产和用户设置来源；不由 App 猜默认业务值。
- 可签窗口、cancel 的核实时间以及链确认策略按服务端事实处理，不在 App 自行压缩安全边界。
- 现有旧交易必须用原协议恢复；v2 execution 未知时不能自动回退旧接口下另一笔。
- 关闭新入口/回滚版本后仍保留 v2 未决单的恢复与查询，不能通过删除本地签名记录“清除处理中”。

## 20. 权威参考

- [SmartX Fast Swap HTTP/WS 契约](https://github.com/smartx-mafia/smartx-backend/blob/master/docs/contracts/fastswap.md)
- [SmartX Fast Swap proto](https://github.com/smartx-mafia/smartx-backend/blob/master/api/fastswap/v1/fastswap.proto)
- [环境地址](https://github.com/smartx-mafia/smartx-backend/blob/master/docs/contracts/environments.md)
- [Privy RN quickstart](https://docs.privy.io/basics/react-native/quickstart)
- [Privy Solana sign-only](https://docs.privy.io/wallets/using-wallets/solana/sign-a-transaction)
- [Privy EIP-712](https://docs.privy.io/wallets/using-wallets/ethereum/sign-typed-data)
- [Privy EIP-7702](https://docs.privy.io/wallets/using-wallets/ethereum/sign-7702-authorization)

后端文档中“除 stream-tickets 外 POST 都需要幂等键”的概括遗漏了新增 `/quote`；本手册按该端点专节/proto 处理两项豁免。文档中“报价过期换新意图”不能应用于已签或发送未知的单：先按本手册恢复同一笔，再根据其终态决定新建。若后端 contract_version 或字段结构变化，先更新适配与夹具，再开放新版本。
