# FOMO 代币详情页 → Mobula API 调研报告

> 调研日期：2026-08-20
> 调研目标：用 Mobula API 完整复刻 FOMO（fomo.family）代币详情页的六块数据——**核心行情、拓展行情、实时行情、图表区、持仓者 tab、交易流 tab**。
> 调研对象：`https://fomo.family/tokens/bnb/0xbeea1d618e533a387d941f58a7d4c9b7bd377777`（BNB 链代币详情页）
> 结论先行：**Mobula 用 4 个 REST 端点 + 2 个 WS 流即可覆盖全部六块**，核心+拓展行情由 `token/details` 一个端点全部返回（已实测）。

---

## 1. 调研背景：FOMO 详情页由什么组成

FOMO 详情页（`/tokens/:chain/:tokenAddress`）由 8 类自有接口拼装，前端 10s 轮询 + WS 实时推送：

| # | 数据 | FOMO 自有接口 |
|---|---|---|
| 1 | Token 核心数据 | `POST /proxy/filterTokens`（body `["{chainId}:{address}"]`） |
| 2 | Token 扩展详情 | `POST /proxy/tokenDetails`（body `{tokenId}`） |
| 3 | 实时价格 | WS topic `prices`（`{priceUsd}`） |
| 4 | 实时涨跌/买卖统计 | WS topic `token_details` |
| 5 | K线 | Mobula `ohlcv-history` / `POST /proxy/getBars` |
| 6 | 持仓者列表 | `GET /hodlers/top`、`/hodlers/devs`、`/hodlers/friends` |
| 7 | 交易流 | `GET /feed/token`（分页无限滚动） |
| 8 | 我的持仓/盈亏 | `GET /v2/users/{id}/balances` |

---

## 2. Mobula 映射方案总览

| 数据块 | Mobula 端点 | 方式 | 实测 |
|---|---|---|---|
| ① 核心行情 | `GET /api/2/token/details` | REST 快照 | ✅ HTTP 200 |
| ② 拓展行情 | **同一个** `token/details` | REST 快照 | ✅ 一个响应全包含 |
| ③ 实时行情 | WS `fast-trade` + WS `market-details`（`wss://api.mobula.io`） | 实时推送 | 📄 文档确认 |
| ④ 图表区 | `GET /api/2/token/ohlcv-history` | REST（+WS 可选） | 📄 文档确认 |
| ⑤ 持仓者 tab | `GET /api/2/token/holder-positions` | REST 分页 | ✅ HTTP 200 |
| ⑥ 交易流 tab | `GET /api/2/token/trades`（`mode=asset`） | REST 分页 | ✅ HTTP 200 |

> 通用参数：生产环境 `https://api.mobula.io`，Header `Authorization: <API Key>`（[admin.mobula.io](https://admin.mobula.io) 生成）；测试用 `demo-api.mobula.io`（限速）。chainId 格式：`evm:56`、`solana:solana`、`evm:8453`、`evm:143`、`evm:1337`、`evm:4663`。

---

## 3. ① + ② 核心行情 & 拓展行情：`GET /api/2/token/details`

### 3.1 请求

```bash
curl -X GET "https://api.mobula.io/api/2/token/details?blockchain=evm:56&address=0xbeea1d618e533a387d941f58a7d4c9b7bd377777"
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `blockchain` | ✅ | `evm:56` / `solana` 等 |
| `address` | ✅ | 合约/mint 地址 |
| `currencies` | ❌ | 多币种转换，默认 USD（支持 EUR/GBP/CNY 等） |

支持 POST 批量（一次最多多个 token）。

### 3.2 字段对应表（FOMO → Mobula）

**核心行情：**

| FOMO 详情页展示 | Mobula 字段（实测返回） |
|---|---|
| 代币名 / 符号 / 精度 / logo | `name` / `symbol` / `decimals` / `logo` |
| 当前价格 | `priceUSD` |
| 市值 / 稀释市值(FDV) | `marketCapUSD` / `marketCapDilutedUSD` |
| 流动性 | `liquidityUSD` / `liquidityMaxUSD` |
| 24h 交易量 | `volume24hUSD` |
| 持有人数 | `holdersCount` |
| 总供应 / 流通供应 | `totalSupply` / `circulatingSupply` |
| 创建时间（图表创建标记） | `createdAt` |
| 发行平台 / 曲线状态 | `source` / `exchange` / `bonded` / `bondingPercentage` / `bondingCurveAddress` / `poolAddress` / `bondedAt` |
| 交易所信息 | `exchange.{name, logo}` / `factory` |
| ATH / ATL | `athUSD` / `atlUSD` / `athDate` / `atlDate` |

**拓展行情：**

| FOMO 详情页展示 | Mobula 字段 |
|---|---|
| 各时段涨跌幅（1m/5m/1h/4h/6h/12h/24h） | `priceChange1minPercentage` / `priceChange5minPercentage` / `priceChange1hPercentage` / `priceChange4hPercentage` / `priceChange6hPercentage` / `priceChange12hPercentage` / `priceChange24hPercentage` |
| 各时段交易量 | `volume1minUSD` ~ `volume24hUSD`（1m/5m/15m/1h/4h/6h/12h/24h） |
| 各时段买入/卖出量 | `volumeBuy1min~24hUSD` / `volumeSell1min~24hUSD` |
| 买卖笔数 / 人数（各时段） | `trades*` / `buys*` / `sells*` / `buyers*` / `sellers*` / `traders*` |
| 买入卖出对比条（笔数/金额/人数） | 用 `buys vs sells`、`volumeBuy vs volumeSell`、`buyers vs sellers` 计算比例 |
| 前十/前五十/前百/前二百持仓占比 | `top10HoldingsPercentage` / `top50HoldingsPercentage` / `top100HoldingsPercentage` / `top200HoldingsPercentage` |
| dev / 内幕 / 捆绑 / 狙击手 / 专业交易者持仓 | `devHoldingsPercentage` / `insidersHoldingsPercentage` / `bundlersHoldingsPercentage` / `snipersHoldingsPercentage` / `proTradersHoldingsPercentage` / `freshTradersHoldingsPercentage`（含对应 Count） |
| 手续费（各时段） | `feesPaid1min~24hUSD` / `totalFeesPaidUSD` |
| 有机数据（去机器人） | `organicTrades*` / `organicTraders*` / `organicVolume*` / `organicBuys*` / `organicSells*` / `organicBuyers*` / `organicSellers*` |
| 安全审计 | `security.{buyTax, sellTax, isHoneypot, isMintable, isBlacklisted, isNotOpenSource, renounced, locked, burnRate, liquidityBurnPercentage, noMintAuthority, isProxy, lowLiquidity}` |
| 社交链接 | `socials.{twitter, telegram, website, others, uri}` |
| 部署者 | `deployer` / `deployerMigrationsCount` |
| Dexscreener 聚合 | `dexscreenerListed` / `dexscreenerBoosted` / `dexScreenerEnhanced.{description, isCto, links, icon, header}` |
| 其他质量标签 | `isMayhemMode` / `isCashbackCoin` / `isOGCoin` / `twitterReusesCount` / `twitterRenameCount` / `liquidityBurnPercentage` |

> **实测确认**（BNB token `0xbeea1d...`）：返回 `priceUSD=0.0413`、`marketCapUSD=41.25M`、`liquidityUSD=823K`、`volume24hUSD=15.05M`、`holdersCount=34509`、`priceChange24hPercentage=-0.37%`、`bonded=true`、`socials{twitter,website,telegram}`。

---

## 4. ③ 实时行情：WS 流（`wss://api.mobula.io`）

> ⚠️ 仅 **Growth（$400/月）及以上** 计划；单组织跟踪上限 **50 个 market/token**。

### 4.1 `fast-trade`（实时成交，驱动图表/价格数字）

```json
{
  "type": "fast-trade",
  "authorization": "YOUR-API-KEY",
  "payload": {
    "assetMode": true,
    "items": [
      { "blockchain": "evm:56", "address": "0xbeea1d..." }
    ],
    "subscriptionTracking": true,
    "maxUpdatesPerMinute": 60
  }
}
```

- 亚秒级延迟，payload 精简（价格、金额、方向、hash）——**对标 FOMO 的 `prices` topic + 图表实时刷新**
- `assetMode=true` 按 token 订阅（跨池聚合）；`false` 按池订阅

### 4.2 `market-details`（富化统计，dashboard 用）

```json
{
  "type": "market-details",
  "authorization": "YOUR-API-KEY",
  "payload": {
    "pools": [
      { "blockchain": "evm:56", "address": "0xbeea1d..." }
    ],
    "subscriptionTracking": true
  }
}
```

- 每次交易重算的聚合统计：volumes、trade counts、holder percentages、fee stats 等——**对标 FOMO 的 `token_details` topic（买卖对比条）**
- ⚠️ 文档明确：**不适用于图表动画**（富化处理延迟可达 ~1s），图表动画用 `fast-trade`

---

## 5. ④ 图表区：`GET /api/2/token/ohlcv-history`

### 5.1 请求

```bash
curl -X GET "https://api.mobula.io/api/2/token/ohlcv-history?address=0xbeea1d...&chainId=evm:56&period=5m&from=1720000000&to=1725000000&usd=true"
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `address` | ✅ | token 地址 |
| `chainId` | ❌ | `evm:56` / `solana` 等 |
| `period` | ❌ | `1s / 1m / 5m / 15m / 30m / 1h / 4h / 12h / 1d / 1w` |
| `from` / `to` | ❌ | Unix 秒时间范围 |
| `usd` | ❌ | `true` 返回美元计价 |
| `amount` / `fill` | ❌ | 高级选项 |

### 5.2 字段对应

| FOMO 图表要素 | Mobula 方案 |
|---|---|
| K线 OHLCV | `token/ohlcv-history` 返回数组（open/high/low/close/volume/time） |
| 值模式切换（价格/市值） | 市值模式 = OHLC × `totalSupply`（来自 `token/details`） |
| 创建标记 | `token/details.createdAt` |
| 大额交易标记 | 自建：从 `token/trades` 拉 `minAmountUSD` 过滤，或 `fast-trade` WS 实时聚合 |

> 对应 FOMO 的刷新节奏：REST 2-10s 轮询兜底 + `fast-trade` WS 实时。`token/ohlcv-history` 也是 FOMO 自己使用的端点（`fomo-api.mobula.io` 白标）。

---

## 6. ⑤ 持仓者 tab：`GET /api/2/token/holder-positions`

### 6.1 请求

```bash
curl -X GET "https://api.mobula.io/api/2/token/holder-positions?address=0xbeea1d...&blockchain=evm:56&limit=50&offset=0&useSwapRecipient=true&includeFees=true"
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `blockchain` / `address` | ✅ | 链 + token 地址 |
| `label` | ❌ | 按交易者类型过滤：`sniper | insider | bundler | proTrader | smartTrader | freshTrader | dev | liquidityPool | locker` |
| `walletAddresses` | ❌ | 指定钱包 |
| `limit` / `offset` | ❌ | 分页（limit 默认 100，最大 1000）——对应 FOMO 无限滚动 |
| `force` | ❌ | 绕过缓存取最新 |

支持 POST 批量（最多 10 个 token）。

### 6.2 字段对应表（实测确认）

| FOMO 持仓者行 | Mobula 字段 |
|---|---|
| 持仓数量 | `tokenAmount`（human-readable） / `tokenAmountRaw` |
| 持仓价值(USD) | `tokenAmountUSD` |
| 占总供应% | `percentageOfTotalSupply` |
| 已实现盈亏 | `realizedPnlUSD`（`pnlUSD` 已废弃） |
| 未实现盈亏 | `unrealizedPnlUSD` |
| 总盈亏 / 盈亏% | `totalPnlUSD`（= 已实现+未实现；%/costBasis 自算） |
| 平均建仓价（= FOMO averageEntryPrice） | `avgBuyPriceUSD` |
| 平均卖出价 | `avgSellPriceUSD` |
| 买入/卖出笔数 | `buys` / `sells` |
| 买入/卖出量 | `volumeBuyToken` / `volumeSellToken` / `volumeBuyUSD` / `volumeSellUSD` |
| 首次/最后交易时间 | `firstTradeAt` / `lastTradeAt` / `walletFundAt` / `lastActivityAt` |
| 交易平台 | `platform`（Photon/BullX/Axiom/Raydium…） |
| 资金标签 | `labels`（sniper/insider/bundler/proTrader/dev…） |
| 钱包实体信息 | `walletMetadata`（locker 时含 entityName，如 Streamflow） |
| 资金来源 | `fundingInfo` |

**对标 FOMO 的过滤逻辑：**
- FOMO `holders` tab 全量 → 不传 `label`
- FOMO Dev 持仓视图 → `&label=dev`
- FOMO 好友视图 → `&walletAddresses=好友地址列表`（社交好友关系需自建映射）
- FOMO 前 N 名 → `limit` + `offset` 分页

---

## 7. ⑥ 交易流 tab：`GET /api/2/token/trades`

### 7.1 请求

```bash
curl -X GET "https://api.mobula.io/api/2/token/trades?address=0xbeea1d...&blockchain=evm:56&mode=asset&limit=20&offset=0&sortOrder=desc"
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `blockchain` / `address` | ✅ | 链 + token 地址 |
| `mode` | ❌ | `pair`（默认，按池）/ `asset`（跨池聚合，**推荐**） |
| `limit` / `offset` | ❌ | 分页（默认 10，最大 1000） |
| `sortOrder` | ❌ | `asc` / `desc` |
| `type` | ❌ | `buy` / `sell` 过滤 |
| `minAmountUSD` / `maxAmountUSD` | ❌ | 金额区间 |
| `fromDate` / `toDate` | ❌ | 时间范围 |
| `label` | ❌ | `PRO_TRADER` / `SMART_TRADER` / `DEV` 等 |
| `swapTypes` / `transactionSenderAddresses` | ❌ | 高级过滤 |

### 7.2 字段对应表（实测确认）

| FOMO 交易流条目 | Mobula 字段 |
|---|---|
| 交易方向 | `type`（buy/sell/deposit/withdrawal）+ `operation` |
| 成交金额 | `baseTokenAmountUSD` / `baseTokenAmount` / `baseTokenAmountRaw` |
| 计价币金额 | `quoteTokenAmountUSD` / `quoteTokenAmount` |
| 成交时间 | `date`（毫秒时间戳） |
| 交易哈希 | `transactionHash` |
| 发送方 / 受益方 | `swapSenderAddress` / `swapRecipient`（AA 场景关键）/ `transactionSenderAddress` |
| 代币元数据 | `baseToken` / `quoteToken`（含 name/symbol/logo/priceUSD） |
| 钱包标签 | `labels`（smart-money / pro-trader…） |
| 交易平台 | `platform`（Photon/BullX/GMGN/Trojan…，含 id/name/logo） |
| 手续费 | `totalFeesUSD` / `gasFeesUSD` / `platformFeesUSD` / `mevFeesUSD` |
| 池地址 | `marketAddress` / `marketAddresses` |

---

## 8. 边界与差异（Mobula 覆盖不到的）

| FOMO 功能 | Mobula 能否覆盖 | 说明 |
|---|---|---|
| **thesis 观点流**（`/feed/token/thesis`，用户发帖） | ❌ | FOMO 自研社交功能，Mobula 无社交数据 → 自建或砍掉 |
| **我的持仓/盈亏**（当前登录用户） | ⚠️ 部分 | 用 wallet 系列：`/api/2/wallet/positions`（持仓，含 realizedPnlUSD/unrealizedPnlUSD/averageEntryPrice）+ `/api/2/wallet/trades`（历史）组合 |
| **好友持仓过滤** | ⚠️ 部分 | Mobula 无社交关系图，需自建好友→钱包映射后用 `walletAddresses` |
| **trending 热度算法** | ⚠️ 部分 | 用 `token/details` 的 `trendingScore*` / `feesPaid*` 字段自建排序 |

---

## 9. 落地架构建议

```
┌─ 快照层（REST，5-10s 轮询或按需）─────────────────┐
│  GET /api/2/token/details          → 核心+拓展行情 │
│  GET /api/2/token/ohlcv-history    → 图表 K线      │
│  GET /api/2/token/holder-positions → 持仓者列表    │
│  GET /api/2/token/trades           → 交易流        │
└──────────────────────────────────────────────────┘
┌─ 实时层（WS，wss://api.mobula.io，Growth+）───────┐
│  fast-trade     → 实时价格/成交 → 驱动图表、价格   │
│  market-details → 实时富化统计 → 买卖对比条        │
└──────────────────────────────────────────────────┘
后端聚合 → Redis 缓存 → 自建接口/WS 提供给前端
```

**推荐刷新节奏**（对齐 FOMO）：`token/details` 10s、`ohlcv-history` 2-10s（WS 可用时实时）、`holder-positions` 10s、`trades` 分页按需、实时层全走 WS。

---

## 10. 参考来源

- [Mobula Token Details 文档](https://docs.mobula.io/rest-api-reference/endpoint/token-details)
- [Mobula Market Details 文档](https://docs.mobula.io/rest-api-reference/endpoint/market-details)
- [Mobula Token Holder Positions 文档](https://docs.mobula.io/rest-api-reference/endpoint/token-holder-positions)
- [Mobula Token Trades 文档](https://docs.mobula.io/rest-api-reference/endpoint/token-trades)
- [Mobula Fast Trades Stream 文档](https://docs.mobula.io/indexing-stream/stream/websocket/wss-fast-trades)
- [Mobula Market Details Stream 文档](https://docs.mobula.io/indexing-stream/stream/websocket/wss-market-details)
- [Mobula 官方 OpenAPI](https://api.mobula.io/openapi.json)

