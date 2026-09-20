# Dev Harness Robinhood PONS 买入完整时间线

- 测试时间：2026-09-20
- 环境：`/dev/harness`，测试环境
- 运行后端：`e526f95b`
- 路线：Solana USDC → Robinhood PONS
- 投入：`2,000,000` raw USDC（2 USDC）
- 滑点：300 bps
- swap_id：`95bab3b1-0dec-4b47-9100-1e6062a2e1af`
- client_intent_id：`8060c2fc-e4b3-49dd-b3f7-cd2a55a23656`
- Create trace：`58b7fd66574c17b8b25ee8cec814127f`
- Execution trace：`df339ab0d455509761145227d0fbe9a7`

## 结论

交易全流程完成：源链确认、Relay filled、Robinhood 目的链确认、账务 posted、outcome completed。

- Harness 点击到终态：**8.185 秒**
- Create：2.695 秒
- 签前核对：3 ms
- Privy 签名：1.146 秒
- 序列化：1 ms
- Execution HTTP：726 ms
- 等待终态：3.615 秒
- 实际到账：`3.032824440024545181 PONS`

## 前端单调时间线

前端时间使用同一页面的单调时钟。显示时钟为本机时间，只用于标识事件，不与服务器 UTC 直接相减。

| 本机时间 | 距点击 | 事件 |
| --- | ---: | --- |
| 16:37:39.288 | 0 ms | 点击执行，开始 Create |
| 16:37:41.860 | 2,573 ms | 收到 swap_id |
| 16:37:41.983 | 2,695 ms | Create 完成，开始签前核对 |
| 16:37:41.986 | 2,698 ms | 签前核对完成，进入 Privy 签名 |
| 16:37:43.132 | 3,844 ms | Privy 签名完成，开始上报 |
| 16:37:43.858 | 4,570 ms | Execution HTTP 完成，开始等待终态 |
| 16:37:45.246 | 5,958 ms | 页面首次看到源链 confirmed |
| 16:37:47.473 | 8,185 ms | 页面收到 completed |
| 16:37:47.474 | 8,186 ms | 页面同次刷新看到目的链和账务完成 |

## 后端 UTC 时间线

HTTP 接收时刻使用“完成日志时刻减中间件 latency”估算，只用于当前服务端时间轴。

| 服务器 UTC | 事件 |
| --- | --- |
| 08:37:45.164（估算） | Fast Swap 接收 Create 请求 |
| 08:37:45.175 | swaps 行创建 |
| 08:37:45.188 | revision ready 事件发生 |
| 08:37:47.587 | Create HTTP 完成，latency 2.423 s |
| 08:37:49.044（估算） | Fast Swap 接收 ReportExecution |
| 08:37:49.052 | 签名产物 reported 入库 |
| 08:37:49.565 | 服务端广播出口 accepted |
| 08:37:49.580 | ReportExecution HTTP 完成，latency 536 ms |
| 08:37:50.645 | 源链状态进入 confirmed |
| 08:37:51.476 | 后端记录 Robinhood 目的资产 observed |
| 08:37:52.249 | Relay filled，目的链进入 confirmed |
| 08:37:52.385 | 两条账本分录 posted_at |
| 08:37:52.466 | accounting posted，outcome completed |

从服务端接收 Execution 估算点计算：

- 到广播 accepted：约 0.520 秒
- 到源链 confirmed：约 1.601 秒
- 到 Robinhood observed：约 2.432 秒
- 到 Robinhood confirmed：约 3.205 秒
- 到账本 posted：约 3.341 秒
- 到 completed：约 3.422 秒

## 链上回执

### Solana 源链

- signature：`4SjQ5Yab3T55MHA1isWJopdgjea76J3Y1k4uhPU7eRbroeGEsv3qdmxikCXD3inFsTK3nqcJKiigYQA1gu8YAkSa`
- slot：`448679663`
- blockTime：`2026-09-20T08:37:49Z`
- `meta.err = null`
- fee：10,000 lamports
- 实际扣款：2,000,000 raw USDC

### Robinhood 目的链

- tx hash：`0x7c8554a1af4458c98d05dd3f25392fc61c8a2f83df51f24093c9a747f1210073`
- block：`67801624`
- blockTime：`2026-09-20T08:37:50Z`
- receipt status：1
- 实际到账：`3,032,824,440,024,545,181` raw PONS

区块时间只有整秒精度，且浏览器、服务器和链上时钟未做统一校准，因此不使用浏览器点击时间与 blockTime 推导毫秒级入块上界。

## 账务核对

accounting export：`exported`，`attempts=0`，`last_error` 为空。

| 资产 | delta | posted_at UTC |
| --- | ---: | --- |
| Solana USDC | `-2000000` | 08:37:52.384688 |
| Robinhood PONS | `3032824440024545181` | 08:37:52.384688 |

账本金额与两侧链上实测金额一致。

## 最新后端日志发现

1. Create 的 2.423 秒主要包含 Relay 调用：`/price` 819 ms、`/quote/v2` 843 ms，随后另有 `/price` 990 ms 和 445 ms。
2. Execution HTTP 为 536 ms，其中 Solana RPC 慢调用约 345 ms。
3. Worker 查询 Relay status/request 各约 354–355 ms。
4. 出现一条 `可用性事件失败：event_version 没有接上上一版`。本笔交易仍 completed，账本正确，但 availability 事件可能缺失，应单独修复事件版本并发问题。
5. ReportExecution 日志仍输出完整 `signed_transaction_base64`。这属于敏感交易材料日志，应做字段脱敏。
6. swaps 表的 `destination_finalized_at` 仍为 null，但 settlement destination 已为 confirmed。本系统当前的 `confirmed` 是业务确认状态，不能把该字段解释为协议级 finalized。
