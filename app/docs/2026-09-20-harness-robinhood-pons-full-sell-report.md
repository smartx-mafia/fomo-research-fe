# Harness Robinhood PONS 全仓卖出实测

- 测试日期：2026-09-20（Asia/Shanghai）
- 路线：Robinhood `PONS` → Solana `USDC`
- PONS 合约：`0x39dbed3a2bd333467115de45665cc57f813c4571`
- 卖出数量：`3032824440024545181 raw` = `3.032824440024545181 PONS`
- FastSwap 服务端版本：`b4848b753dd2c235dda58af1e8b710b2ed451905`

## 结论

本次出现两次点击尝试：

1. `65cd7eac-6384-42d4-acdd-57d099485aa6`：签名提交晚于 Relay 的 EVM deadline，被 Relay 以 `SIGNATURE_EXPIRED` 拒绝。后端终态为 `failed_no_debit`，没有扣款。
2. `496e4441-c1a0-4ce9-bd3f-719d05eb04f8`：卖出成功。Robinhood 侧交易确认，Solana 侧在同一秒收到 `1.691388 USDC`，最终 FastSwap 账务已 `posted`，结局为 `completed`。

第二笔证明新的点击热路径有效：从点击到 execution HTTP 完成是 **0.981 秒**，其中 Privy 签名 **449 ms**、签名序列化 **1 ms**、execution HTTP **375 ms**。完整交易实际到账也发生在服务端接到点击触发 GET 的下一秒内；最终状态晚约 6 分 44 秒，是测试服 Solana RPC 被 Alchemy `429 Monthly capacity limit exceeded` 阻塞造成的观察延迟，不是链上到账延迟。

## 尝试一：过期且未扣款

### 标识

- swap / trade id：`65cd7eac-6384-42d4-acdd-57d099485aa6`
- client intent id：`7fc0bd08-57d4-4f17-bf75-0579d679849e`
- revision：`1`
- execution trace：`33acfff145c88da70e9dfd5f4d701378`
- Relay request id：`0x1789896048860a6ae9e156db55be3e995ffc5976bf28dc2d09e7a3f5064a3e0f`

### 前端时间线

| 阶段 | 耗时 |
|---|---:|
| 预构建到 READY | 1,284 ms |
| Privy 预热 | 3 ms |
| 点击后轻量对账 | 169 ms |
| 签前核对 | 4 ms |
| Privy 签名 | 1,712 ms（阶段视图约 1.720 s） |
| 序列化 | 8 ms |
| execution HTTP | 358 ms |
| 等待失败终态 | 1.375 s |
| 点击到失败终态 | **3.626 s** |

点击时刻为前端单调时间轴 `17:21:26.877`。服务端在 `09:21:34.680Z` 收到签名报告，而该 revision 的 EVM deadline 是 `09:21:33Z`；`09:21:34.876Z` Relay 返回 `SIGNATURE_EXPIRED`。后端保存验签结果但没有广播成功，最终记录：

```text
execution_status = failed
outcome          = failed_no_debit
failure_cause    = unknown
recovery_action  = refresh_quote
```

这说明当前签前期限守卫只判断“剩余时间大于 0”仍不够。EVM 卖出应在剩余窗口不足安全余量时先 refresh 同一 swap，再允许签名。安全余量应覆盖近期签名耗时、execution 上报及网络抖动，不能只依赖本机墙钟。

## 尝试二：成交

### 标识与结果

- swap / trade id：`496e4441-c1a0-4ce9-bd3f-719d05eb04f8`
- client intent id：`55e5ddaf-b8bc-451b-a7ec-55966c6675f5`
- legacy trade id：`eeb8be55-3e16-4ea5-b590-851cefe9633d`
- revision：`1`
- execution trace：`bfb63fddb5d983082964dba0b7f81981`
- Relay request id：`0x1789896099c92362d364522d812c5ec45965a25d2dde93ce18dd6f23a044006b`
- Robinhood 源链交易：`0x290eb7f16f9670cfac953b2b62f1d60e87594f24365f623cb35c542589766e56`
- Solana 到账交易：`3svpY1PhpXMzFtJSxZwVFuXzgUDiknpAEMsdQMLGpY4jXiwmnvCsjNhAUnrU84xNQBCsAgmjYiYP5XQbJvA58W6Z`
- Solana slot：`448689572`
- 实际收到：`1691388 raw` = **1.691388 USDC**
- 卖出后 Robinhood 钱包 PONS `balanceOf`：`0 raw`（全仓已卖出）
- 报价预计：`1.689384 USDC`
- 报价底线：`1.638702 USDC`
- 实际比预计多：`0.002004 USDC`

### 点击热路径

| 前端阶段 | 时刻 / 耗时 |
|---|---:|
| 预构建到 READY | 1,322 ms |
| Privy 预热 | 1 ms |
| 用户点击 | 17:21:36.728 |
| 点击后同 swap 对账 | 154 ms |
| 签前核对 | 1 ms |
| Privy 签名 | **449 ms**（阶段视图约 450 ms） |
| 序列化 | 1 ms |
| execution HTTP | **375 ms** |
| 点击到 execution HTTP 完成 | **0.981 s** |

Create 与报价在点击前完成，因此 1,322 ms 的预构建不在点击热路径内。点击后增加的一次 GET 只核对同一个 swap 的最新 revision 与 execution 状态，没有重新报价或新建 intent。

### 服务端、Relay 与链上时间线（UTC）

| 时刻 | 事件 | 距上一关键点 |
|---|---|---:|
| 09:21:39.874726 | swap 创建 | — |
| 09:21:39.895749 | READY 事件写入 | 21 ms |
| 09:21:42.662 | 点击触发的 GET 到达服务端 | — |
| 09:21:43.237177 | execution 已接收并持久化 | 575 ms |
| 09:21:43.463 | 已交给 Relay 广播 | 226 ms |
| 09:21:43 | Solana 目的交易入块，USDC 增加 1,691,388 raw | 与 execution 同一秒 |
| 09:21:44.297 | Relay webhook 报 success | execution 后 1.060 s |
| 09:21:44.476688 | Robinhood 源链交易 observed | execution 后 1.240 s |
| 09:21:45.044904 | settlement event v5 | 568 ms |
| 09:22:49.483907 | Robinhood 源链达到业务确认阈值 | observed 后 65.007 s |
| 09:28:27.007111 | worker 补记 Solana 目的链观察 | 链上入块后约 404 s |
| 09:28:27.498260 | accounting posted / completed | 目的观察后 491 ms |
| 09:28:29.231 | 前端轮询取到最终事件 | 后端完成后约 1.733 s |

Solana RPC 返回的链上事实：

```text
confirmationStatus = finalized
err                = null
slot               = 448689572
blockTime          = 1789896103（2026-09-20 09:21:43Z）
USDC pre_raw       = 8879237
USDC post_raw      = 10570625
USDC delta_raw     = 1691388
Robinhood PONS raw = 0
```

由于 Solana `blockTime` 只有秒级精度，而且浏览器墙钟与服务器约有 5.8 秒偏差，不能给出毫秒级点击到入块值。以服务器收到点击触发 GET 的 `09:21:42.662Z` 为起点，目的交易 blockTime 为 `09:21:43Z`，可报告的范围约为 **0.338–1.338 秒**。前端自己的同一单调时钟给出的点击到 execution HTTP 完成值是 **0.981 秒**。

## 后端落表延迟根因与处理

链上资金在 `09:21:43Z` 已经到账，但 FastSwap 长时间保持：

```text
source      = confirmed
relay       = filled
destination = not_seen
accounting  = pending
outcome     = pending
```

worker 日志显示 Solana RPC 持续返回：

```text
429 Too Many Requests
Monthly capacity limit exceeded
```

导致 worker 无法读取目的交易状态。累计 `observe_attempts=54` 后仍未落表。

处理过程：

1. 从测试服务器直接验证前端当前 QuickNode Solana RPC 可用，`getHealth=ok`。
2. 备份测试服配置：`configs/fastswap.yaml.bak-20260920-092826-rpc`。
3. 将测试服 `meme.solana.rpc` 切换到已验证的 QuickNode 节点。
4. 只重启 `smartx-fastswap-worker.service`，服务恢复为 `active`。
5. 下一轮 observer 在约 1 秒内识别已经 finalized 的 Solana 交易；约 0.5 秒后完成账务出口。

最终数据库状态：

```text
execution_status       = accepted
settlement_source      = confirmed
settlement_relay       = filled
settlement_destination = confirmed
settlement_accounting  = posted
outcome                = completed
amount_in_actual_raw   = 3032824440024545181
amount_out_actual_raw  = 1691388
accounting_export      = exported
legacy_trade_status    = confirmed
```

worker 同时留下一个非阻断警告：可用性事件因 `event_version` 未接上上一版而发送失败。交易结局与账务已经完成，但该事件版本竞争仍应单独修复。

## 后续应修的两点

1. **签名前安全余量**：READY 剩余时间不足 `max(固定安全值, 近期 Privy 签名 + execution 上报预算)` 时自动 refresh 同一 swap。首笔 1.7 秒签名暴露了只判断 `> 0` 的缺口。
2. **RPC 容量与退避**：为链观察配置有容量的主节点与备用节点；429 时使用指数退避和 endpoint failover，避免当前约 5 秒一次的持续请求把整个落表链路永久卡住。
