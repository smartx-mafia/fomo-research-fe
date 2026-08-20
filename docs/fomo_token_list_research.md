# FOMO 代币推荐列表调研记录（Mobula Pulse API）

> 调研日期：2026-08-20
> 调研目标：复刻 FOMO（fomo.family）的代币推荐列表（热门 / 新币 / 未毕业 / 毕业），确认用 Mobula 时该请求哪个接口、怎么配。
> 结论先行：**核心接口 = `POST/GET https://api.mobula.io/api/2/pulse`**，其数据模型按 `new / bonding / bonded` 三分类返回 bonding-curve 代币，天然对应 FOMO 的"新币 / pre-graduated / graduated"推荐分类。

---

## 1. 背景：FOMO 代币推荐列表是怎么做的（对照组）

FOMO（登录后 App 的 tokens 页 / discovery 面板）有 6 个 tab，分两种数据通道：

| Tab | 数据通道 | 端点 / WS topic |
|---|---|---|
| Trending（热门） | **纯 WS** | topic `trending_tokens` @ `wss://prod-api.fomo.family/ws` |
| Graduated（毕业） | **纯 WS** | topic `graduated_tokens` |
| Pre-graduated（未毕业） | **纯 WS** | topic `pre_graduated_tokens` |
| Crypto tokens | REST | `POST https://prod-api.fomo.family/proxy/cryptoTokens` |
| Most-held | REST | `POST /proxy/mostHeld` |
| Watchlist | REST 组合 | `GET /watchlist` + `POST /proxy/filterTokens` |

WS 消息为 `{type:"data", topicType, topicId, payload:{kind:"snapshot"|"new"|"update"|"remove", ...}}`，前端按增量合并到本地 store，展示前 100 条。REST 请求带 `Authorization: Bearer <JWT>` + `X-Supported-Chains` 头，2s 轮询兜底。

FOMO 覆盖 7 条链：Solana、Base、BNB、Monad、Ethereum、HyperEVM(1337)、Robinhood Chain(4663)。

---

## 2. Mobula 复刻方案：`/api/2/pulse`（核心接口）

### 2.1 GET 方式（简单配置）

```
GET https://api.mobula.io/api/2/pulse
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `chainId` | string \| repeated | `solana:solana`、`evm:8453`、`evm:1`、`evm:56`、`evm:143`、`evm:1337`、`evm:4663` |
| `poolTypes` | string \| repeated | `pumpfun`、`moonshot-evm` 等（完整列表见 `GET /api/2/system-metadata`） |
| `assetMode` | boolean | token 维度统计（默认 false = pool 维度）；true 时带 holders/socials/security |
| `model` | string | 仅 `default`：自动生成 new/bonding/bonded 三个 view |
| `limit` | number | 最大 100，默认 30 |
| `offset` | number | 分页偏移，默认 0 |
| `compressed` | boolean | 压缩响应 |

示例：
```bash
curl -X GET "https://api.mobula.io/api/2/pulse?assetMode=true&chainId=solana:solana&chainId=evm:8453&limit=50"
```

**响应结构**（三组并列）：
```json
{
  "new":     {"data": [/* 新发行未完成曲线 */]},
  "bonding": {"data": [/* 曲线进行中 = FOMO pre-graduated */]},
  "bonded":  {"data": [/* 曲线完成已上 DEX = FOMO graduated */]}
}
```

### 2.2 POST 方式（高级配置：自定义 views + 排序 + 过滤）⭐ 推荐

```
POST https://api.mobula.io/api/2/pulse
```

请求体结构：

| 顶层字段 | 说明 |
|---|---|
| `model` | `"default"`：不写 views 时自动生成 new/bonding/bonded 三组 |
| `assetMode` | token 维度（默认 true 更推荐） |
| `filterQuotes` | 排除稳定币/原生币等 quote token |
| `excludeLPTokens` | 排除 LP wrapper token（默认 true） |
| `chainId` / `poolTypes` | 同上 |
| `views[]` | 自定义视图数组，见下 |

**views[] 字段**：

| 字段 | 说明 |
|---|---|
| `name` | 视图名，响应按此名分组（如 `{"trending": {"data":[...]}}`） |
| `model` | 可选预置模型：`new` / `bonding` / `bonded`（见第 3 节） |
| `chainId` | 数组，可多链 |
| `sortBy` | 排序字段（见 2.3） |
| `sortOrder` | `asc` / `desc`，默认 `desc` |
| `limit` | 最大 100，默认 30 |
| `offset` | 分页偏移 |
| `addressToExclude` | 排除指定地址 |
| `includeTokens` | 始终包含的地址 |
| `filters` | 过滤条件，支持 `gte` / `lte` / `lt` / `gt` / `equals` / `in` |

**复刻"热门榜"的完整示例**（实测可用）：
```bash
curl -X POST "https://api.mobula.io/api/2/pulse" \
  -H "Content-Type: application/json" \
  -d '{
    "assetMode": true,
    "filterQuotes": true,
    "views": [
      {
        "name": "trending",
        "chainId": ["solana:solana", "evm:8453", "evm:56", "evm:143"],
        "sortBy": "fees_paid_5min",
        "sortOrder": "desc",
        "limit": 50,
        "filters": {
          "volume_1h":   {"lte": 100000000000},
          "liquidity":   {"gte": 37500},
          "market_cap":  {"lte": 100000000},
          "trades_1h":   {"gte": 100},
          "buyers_24h":  {"gte": 100},
          "sellers_24h": {"gte": 100}
        }
      },
      {
        "name": "bonding",
        "chainId": ["solana:solana"],
        "sortBy": "bonding_percentage",
        "sortOrder": "desc",
        "limit": 100,
        "filters": {"bonded": false, "bonding_percentage": {"lt": 100}}
      }
    ]
  }'
```

### 2.3 `sortBy` 可选值

```
created_at, market_cap, volume_1h, latest_trade_date,
price_change_5min, price_change_1h, price_change_4h, price_change_6h, price_change_12h, price_change_24h,
trades_1h, trades_24h, liquidity, holders_count,
fees_paid_5min（实测可用）, bonding_percentage, bonded_at
```

### 2.4 响应字段（assetMode=true 实测）

每个 token 对象字段非常全，做推荐卡片足够：

- 价格类：`price`、`latest_price`、`price_change_1min~24h`、`price_1min_ago~24h_ago`、`ath/atl`
- 交易量类：`volume_1min~24h`、`volume_buy/sell_1min~24h`、`organic_volume_*`（去机器人）、`fees_paid_*`
- 活跃度类：`traders/trades/buys/sells/buyers/sellers_1min~24h`、`organic_*`、`trendingScore1min~24h`（Mobula 自带热度分）
- 基本面：`market_cap`、`marketCapDiluted`、`totalSupply`、`circulatingSupply`、`holdersCount`、`holders_list`
- 曲线状态：`bonded`、`bonded_at`、`bondingPercentage`、`bondingCurveAddress`、`poolAddress`、`preBondingFactory`、`migrating`
- 风控/质量：`securityScore`、`is_spam`、`dexscreenerListed/Boosted`、`devHoldings`、`snipersHoldings`、`smartTradersCount`
- 元数据：`tokenName`、`tokenSymbol`、`logo`、`socials`、`description`、`deployer`、`created_at`

---

## 3. `model` 参数完整枚举

`model` 出现两个位置，语义不同：

### 3.1 顶层 `model`（request body 顶层 / GET query）

| 取值 | 行为 |
|---|---|
| `"default"`（唯一值） | 自动生成 3 个预置 view：`new`、`bonding`、`bonded`（各默认 50 条） |

实测：`POST {"model":"default","assetMode":true,"chainId":["solana:solana"]}` → 返回 `{new:50, bonding:50, bonded:50}`。

### 3.2 `views[].model`（自定义 view 内的预置模型）

| 取值 | 含义 | 内置规则 | 对应 FOMO |
|---|---|---|---|
| `"new"` | 新发行代币 | `bonded:false`，按 `created_at` 降序 | 新币榜 |
| `"bonding"` | 曲线进行中 | `bonding_percentage<100` + 活跃度，按 `market_cap` 降序 | pre-graduated |
| `"bonded"` | 已毕业上 DEX | `bonded:true`，按 `created_at` 降序 | graduated |

> 自定义 view 不写 `model` 时直接用 `sortBy + sortOrder + filters` 完全自定义（复刻热门榜的推荐写法）。

---

## 4. 实时推送（对标 FOMO 的 WS 增量推送）

**Pulse Stream V2**：`wss://api.mobula.io`（仅 Growth $400/月 及 Enterprise 计划）

```json
{
  "type": "pulse-v2",
  "authorization": "YOUR_API_KEY",
  "payload": {
    "model": "default",
    "assetMode": true,
    "chainId": ["evm:8453", "solana:solana"],
    "poolTypes": ["moonshot-evm", "pumpfun"],
    "compressed": false
  }
}
```

自动生成 3 个实时 view（new / bonding / bonded，各 limit 50），支持多 view、暂停/恢复、自定义过滤。断线按指数退避重连，重连后重放订阅并 `repairTail` 补缺口。

---

## 5. 配套接口（完整复刻 FOMO 的接口组合）

| FOMO 功能 | Mobula 对应 API |
|---|---|
| 推荐列表（new/bonding/bonded） | `GET/POST /api/2/pulse` + Pulse Stream V2（WS） |
| 热门榜（trending） | Pulse POST 自定义 view + `sortBy` |
| 大盘总览指标 | `GET /api/2/market/lighthouse`（5 分钟缓存） |
| 代币详情（流动性/市值） | `GET /api/2/market/details` |
| K线图表 | `GET /api/2/token/ohlcv-history` |
| 实时价格 | `GET /api/2/token/price` + Market/Token Details Stream（WS） |
| 池类型/链清单 | `GET /api/2/system-metadata`（需 API key） |

---

## 6. OpenAPI / Swagger 文件（可导入 Apifox）

- **官方文件**：`https://api.mobula.io/openapi.json`（OpenAPI 3.1.0，JSON，42 个端点，无 YAML 版本）
- 认证：全局 `security` — `Authorization` header 传 API key（或 MPP bearer）
- ⚠️ **官方文件缺 `/api/2/pulse`**（以及 WS 流）
- 补充文件（官方 42 端点 + pulse GET/POST，43 端点）：`/tmp/mobula_openapi_full.json`（调研期生成，未入库）
- WS 流不在 OpenAPI 覆盖范围，Apifox 需手动添加 WebSocket 接口

---

## 7. 常见坑

1. **JSON body 不能带注释**（`// xxx`）——标准 JSON 不允许，服务端返回 `400 Body is not valid JSON`；复杂 body 建议存文件用 `curl -d @file.json`。
2. **POST 响应按 view 名分组**（`{"my-view": {"data":[...]}}`），GET / 顶层 default 才是 `{new, bonding, bonded}`。
3. **环境**：测试用 `demo-api.mobula.io`（限速、可不带 key），生产用 `api.mobula.io` + key（[admin.mobula.io](https://admin.mobula.io) 生成）。
4. **套餐**：Pulse REST 所有套餐可用；Pulse Stream V2 仅 Growth（$400/月）及以上；免费档 10K credits / 1 RPS 只够验证。
5. **chainId 格式**：`solana:solana`、`evm:8453`、`evm:56`、`evm:1`、`evm:143`（Monad）、`evm:1337`（HyperEVM）、`evm:4663`（Robinhood）——与 FOMO 7 链一致。

---

## 8. 关键结论

1. 复刻 FOMO 推荐列表 = Mobula **`/api/2/pulse`**（REST，new/bonding/bonded 三分类天然匹配）。
2. 推荐架构：Pulse Stream V2（WS 实时）+ Pulse POST（REST 兜底，30s~1min 轮询）——复刻 FOMO 的"WS 增量 + REST 兜底"双通道。
3. trending 无现成端点，用自定义 view + `sortBy`（fees_paid_5min / volume / trendingScore）组合实现。

