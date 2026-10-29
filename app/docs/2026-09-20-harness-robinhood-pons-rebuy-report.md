# Harness Robinhood PONS 2 USDC 回购买入实测

- 测试日期：2026-09-20（Asia/Shanghai）
- 路线：Solana USDC → Robinhood PONS
- PONS 合约：`0x39dbed3a2bd333467115de45665cc57f813c4571`
- 投入：`2000000 raw` = `2 USDC`
- FastSwap 服务端版本：`b4848b753dd2c235dda58af1e8b710b2ed451905`

## 结论

交易成功，FastSwap 终态为 `completed`，账务为 `posted / exported`：

- swap / trade id：`47fb7c8b-d5ee-46e0-b2dc-0de1423d6fb7`
- client intent id：`e7dc32b3-8837-4df7-bcd8-e4309edf867a`
- legacy trade id：`a140e513-6732-4192-a372-3c5f4b3e2e83`
- 投入：`2 USDC`
- 实际到账：`3056399872239171066 raw` = **3.056399872239171066 PONS**
- Solana USDC：`10.570625 → 8.570625`，正好扣除 `2 USDC`
- Robinhood PONS `balanceOf`：`3056399872239171066 raw`
- 点击到完整终态：**4.903 秒**
- 点击到 execution HTTP 完成：**1.348 秒**
- Privy 签名：**396 ms**

本次发生在测试服 Solana observer RPC 切换到已验证的 QuickNode 之后。目的链观察没有再次被 429 阻塞；与上一笔卖出相比，后端落表从约 6 分 44 秒恢复到秒级。

## 报价与准备

| 项目 | 值 |
|---|---:|
| 展示报价 HTTP | 1,117 ms |
| 完整可签交易预构建 | 2,031 ms |
| Privy signer 预热 | 764 ms |
| 展示预计到账 | 3.056891710492698356 PONS |
| 展示最低到账 | 2.965184959177917405 PONS |
| revision 预计到账 | 3.056486030253237543 PONS |
| revision 最低到账 | 2.964791449345640416 PONS |
| 实际到账 | **3.056399872239171066 PONS** |

展示报价与 Create 并行运行；2,031 ms 的预构建在点击前完成，不计入点击热路径。

## 前端点击时间线

用户点击：`17:56:37.382`。

| 阶段 | 耗时 | 累计 |
|---|---:|---:|
| 点击后同 swap 对账 | 223 ms | 223 ms |
| 签前核对 | 2 ms | 225 ms |
| Privy 签名 | **396 ms** | 622 ms |
| 签名序列化 | 1 ms | — |
| execution 上报 | **727 ms**（纯 HTTP 725 ms） | **1.348 s** |
| 等待源链、Relay、目的链和账务终态 | 3.555 s | **4.903 s** |

前端首见：

```text
源链确认     17:56:39.968
目的链观察   17:56:42.285
账务入账     17:56:42.285
终态完成     17:56:42.285
```

## 服务端与链上时间线（UTC）

| 时刻 | 事件 | 距上一关键点 |
|---|---|---:|
| 09:56:29.464012 | swap 创建 | — |
| 09:56:29.488544 | READY 事件写入 | 25 ms |
| 09:56:43.371 | 点击触发的 GET 到达服务端 | — |
| 09:56:44.231357 | execution 已接收并持久化 | 860 ms |
| 09:56:44 | Solana 出资交易入块 | 与 execution 同一秒 |
| 09:56:44.796515 | execution/settlement 更新 | 565 ms |
| 09:56:45.458384 | 源链状态为 confirmed | 662 ms |
| 09:56:46 | Robinhood 目的交易入块 | Solana 入块后约 2 s |
| 09:56:46.950407 | worker 观察到目的交易 | 区块秒内 |
| 09:56:47.605728 | Relay filled + destination confirmed | 655 ms |
| 09:56:48.064139 | accounting posted + completed | 458 ms |

### Solana 出资交易

```text
signature          = NEmr4RZ7Pf9Yuxys1ZPpyevNPAgn3Ba7QiM395m75m2jCrU8R9ZYAdKGDFt9USfz5xK19K6vVaWeqv1p9Dp59V2
slot               = 448697460
blockTime          = 1789898204（2026-09-20 09:56:44Z）
confirmationStatus = finalized
err                = null
amount_raw         = 2000000 USDC raw
```

### Robinhood 到账交易

```text
tx_hash       = 0xcf695db36d61dbaad030081580235ba5f00eb7cf932e381d6f2e1409b8a324ae
block_number  = 67848419
blockTime     = 1789898206（2026-09-20 09:56:46Z）
receipt       = success
PONS raw      = 3056399872239171066
```

### Relay 与账务

```text
relay_request_id   = 0x1789898189eb09e2aefa65b2aeb074d02116751e269c2f7313ebaf68030a571e
execution_status   = accepted
source             = confirmed
relay              = filled
destination        = confirmed
accounting         = posted
outcome            = completed
accounting_export  = exported
legacy_trade       = confirmed
```

## 对优化效果的判断

这笔买入的 Privy 签名为 **396 ms**，点击到 execution HTTP 完成为 **1.348 秒**。相较迁移前 Harness 的约 2.1 秒点击到 submit，Create 已完全移出点击热路径；当前超出 1 秒的主要部分是：

- 点击后安全对账：223 ms；
- Privy 签名：396 ms；
- execution HTTP：725 ms。

三段有少量重叠，但 execution HTTP 仍是本笔点击热路径的最大单段。若目标是稳定低于 1 秒，下一步应优先拆解 execution 的 725 ms TTFB/服务端广播耗时，同时保留点击时同 swap 对账，不能为省约 200 ms 而签缓存中的旧 revision。

本笔仍出现一次非阻断警告：worker 发布 availability 事件时遇到 `event_version` 竞争；settlement、账务和兼容交易行均已正确完成，后续应单独修复该事件发布竞争。

## 随后全仓卖出

买入完成后，将本笔获得的 `3056399872239171066 raw` PONS 全部卖回 Solana USDC。

- swap / trade id：`9e0488dc-f590-4e0c-8424-4dacf2365769`
- client intent id：`57aea73a-1dca-4f24-a04b-1e0b05b483e4`
- legacy trade id：`31642708-e1bb-4f6f-9f4e-933af7baaeb4`
- 实际卖出：`3.056399872239171066 PONS`
- 实际收到：**1.704318 USDC**
- 卖出后 Robinhood PONS `balanceOf`：`0 raw`
- Solana USDC：`8.570625 → 10.274943`

### 卖出前端时间线

| 阶段 | 耗时 |
|---|---:|
| 展示报价 | 1,171 ms |
| 预构建到 READY | 1,472 ms |
| Privy 预热 | 3 ms |
| 点击后同 swap 对账 | 133 ms |
| 签前核对 | 3 ms |
| Privy 签名 | **1,330 ms**（阶段视图 1.345 s，含 15 ms 序列化） |
| execution HTTP | **409 ms** |
| 点击到 execution HTTP 完成 | **1.891 s** |
| 等待完整终态 | 2.327 s |
| 点击到完整终态 | **4.218 s** |

### 卖出链路

```text
Robinhood source tx = 0x9683b5a94255e34b7967b3190a23350f622f07ecac93db892659cd38d583ed91
Solana destination  = 571gULkZUygA6cqJD9QovX2vvUAQqcgaG8tiTkxD8ZDXHgVXbnNJ4nPZy4vM25tXtB2FTeeNJL23MhW43TysmaDp
Solana slot         = 448699764
Solana blockTime    = 1789898816（2026-09-20 10:06:56Z）
Solana status       = finalized / err=null
USDC delta_raw      = 1704318
```

后端关键事件：

| 时刻（UTC） | 事件 |
|---|---|
| 10:06:49.702604 | swap 创建 |
| 10:06:49.716470 | READY |
| 10:06:54.766 | 点击触发的 GET 到达服务端 |
| 10:06:56.285713 | execution 接收并持久化 |
| 10:06:56 | Solana 目的资产入块 |
| 10:06:57.401778 | Robinhood 源交易 observed |
| 10:06:58.044624 | source confirmed / Relay filled / destination confirmed |
| 10:06:58.644997 | accounting posted / completed |

最终数据库状态为 `accepted / confirmed / filled / confirmed / posted / completed`，兼容账务出口为 `exported`。

这一轮买入再卖出的资金结果是 `2.000000 USDC → 1.704318 USDC`，差额 `0.295682 USDC`（约 `14.7841%`）。该值包含两次交易的价格变化、路由价差和费用，只作为本轮真实测试结果记录。
