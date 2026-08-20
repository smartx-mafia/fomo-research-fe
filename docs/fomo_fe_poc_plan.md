# FOMO 前端 PoC 实施规划

> 制定日期：2026-08-20
> 目标：用 Next.js 快速搭一个"能跑起来的 FOMO 复刻版"，**证明 Mobula 接口能撑起前端**，不追求完整产品。
> 输入文档：[`fomo_token_list_research.md`](./fomo_token_list_research.md)（列表）、[`mobula_token_detail_api.md`](./mobula_token_detail_api.md)（详情）
> 已确认决策：范围 = 列表页 + 详情页；实时 = 先轮询、预留 WS；UI = 深色交易终端风 + 英文文案。

---

## 0. 前置实测结论（2026-08-20 已验证）

`https://demo-api.mobula.io` **无需 API key**，以下 5 个端点全部 HTTP 200，字段与调研文档一致：

| 端点 | 状态 | 备注 |
|---|---|---|
| `GET /api/2/pulse` | ✅ 200 | 返回 `{new, bonding, bonded}` 三组 |
| `GET /api/2/token/details` | ✅ 200 | 9.2KB，核心+拓展行情一次全给 |
| `GET /api/2/token/trades` | ✅ 200 | `mode=asset` 跨池聚合 |
| `GET /api/2/token/holder-positions` | ✅ 200 | 含 PnL / labels |
| `GET /api/2/token/ohlcv-history` | ✅ 200 | 80KB，`{v,o,h,l,c,t}` 数组 |

→ **PoC 阶段可以零成本启动**，不用等 API key。

⚠️ 唯一约束：demo 环境限速约 **1 RPS**。所以 BFF 层必须做短缓存（见 §4.3），否则多开几个浏览器 tab 就 429。

---

## 1. PoC 边界

### 要做的
- 代币列表页（Trending / New / Bonding / Bonded 四 tab）
- 代币详情页（行情 + K线 + 持仓者 + 交易流）
- Next.js BFF 转发层（解决跨域 + 藏 API key）
- 首屏 SSR + 客户端轮询刷新

### 明确不做的（PoC 砍掉）
| 砍掉的 | 原因 |
|---|---|
| WebSocket 实时推送 | 需 Growth $400/月；用轮询等价验证 |
| 登录 / 钱包连接 / 交易下单 | 与"接口可行性"无关 |
| Watchlist / Most-held / 我的持仓盈亏 | 需用户体系 |
| thesis 社交观点流 | Mobula 无此数据，FOMO 自研 |
| 好友持仓过滤 | 需自建社交关系图 |
| 多语言框架 / 多币种切换 | 直接写死英文 + USD |
| 移动端精细适配 | 桌面优先，够看即可 |

---

## 2. 技术选型（以"快"为第一原则）

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | **Next.js 15 App Router + TypeScript** | Server Component 天然是 BFF，SSR 首屏免费 |
| 样式 | **Tailwind CSS v4** | `create-next-app` 自带，零配置 |
| 组件库 | **不用** | shadcn/ui 初始化+调主题成本 > PoC 收益，手写十几个 div 更快 |
| 数据获取 | **SWR** | `refreshInterval` 一行搞定轮询 + 焦点重连 + 去重，比手写 useEffect 省一半代码 |
| 图表 | **lightweight-charts**（TradingView） | ~45KB，30 行出专业 K 线，OHLCV 格式几乎直接喂 |
| 状态管理 | **不用** | SWR 缓存 + URL query 足够 |

依赖总数：`next` `react` `tailwindcss` `swr` `lightweight-charts` —— 5 个，`npm i` 一次装完。

---

## 3. 目录结构

```
research-fomo-fe/
├─ docs/                          # 现有调研文档
└─ app/                           # Next.js 项目根
   ├─ .env.local                  # MOBULA_API_HOST / MOBULA_API_KEY
   ├─ src/
   │  ├─ lib/
   │  │  ├─ mobula.ts             # server-only fetch 封装（base url + key + 缓存）
   │  │  ├─ types.ts              # Pulse / TokenDetails / Trade / Holder 的 TS 类型（只写用到的字段）
   │  │  └─ format.ts             # 金额/百分比/时间缩写（$1.2M、+3.4%、2h ago）
   │  ├─ app/
   │  │  ├─ layout.tsx            # 深色主题 + 顶部 nav
   │  │  ├─ page.tsx              # ① 列表页（SSR 首屏）
   │  │  ├─ token/[chain]/[address]/page.tsx   # ② 详情页（SSR 首屏）
   │  │  └─ api/mobula/[...path]/route.ts      # ③ BFF 通用转发（浏览器轮询用）
   │  └─ components/
   │     ├─ TokenTable.tsx        # 列表页表格（client，SWR 轮询）
   │     ├─ ChainFilter.tsx       # 链筛选
   │     ├─ PriceChart.tsx        # K 线（client，lightweight-charts）
   │     ├─ StatGrid.tsx          # 详情页指标网格
   │     ├─ BuySellBar.tsx        # 买卖对比条
   │     ├─ TradesTab.tsx         # 交易流（client，SWR 轮询 + 翻页）
   │     └─ HoldersTab.tsx        # 持仓者（client，SWR + 翻页）
   └─ ...
```

---

## 4. 核心设计

### 4.1 数据流（SSR + 轮询双通道）

```
┌── 首屏（Server Component）──────────────────────────────┐
│  page.tsx ──直连──> api.mobula.io    ← 无跨域，key 不出服务端 │
│           └─> 渲染好的 HTML 返回浏览器（首屏不白屏、可 SEO）    │
└────────────────────────────────────────────────────────┘
┌── 刷新（Client Component + SWR）────────────────────────┐
│  TokenTable ──fetch──> /api/mobula/*  ──> api.mobula.io │
│           refreshInterval: 5s（列表）/ 10s（详情）         │
└────────────────────────────────────────────────────────┘
```

关键点：**服务端和浏览器走同一套 `lib/mobula.ts` 逻辑**，只是入口不同（Server Component 直调 vs 经 route handler）。这样加 WS 时只换客户端那一路。

### 4.2 BFF 转发层：一个 catch-all 搞定全部

`src/app/api/mobula/[...path]/route.ts`：

```
GET/POST  /api/mobula/<any-mobula-path>?<query>
        → https://{MOBULA_API_HOST}/api/2/<any-mobula-path>?<query>
          + Header: Authorization: {MOBULA_API_KEY}
```

- 一个文件覆盖 pulse / token-details / trades / holder-positions / ohlcv-history 全部
- 白名单校验 path 前缀（`pulse`、`token/`、`market/`），防止被当开放代理
- 透传 query string，POST 透传 body

### 4.3 缓存与限速保护（必做，否则 demo 环境直接 429）

| 端点 | 服务端缓存 TTL | 客户端轮询 |
|---|---|---|
| `pulse` | 3s | 5s |
| `token/details` | 5s | 10s |
| `token/trades` | 3s | 5s |
| `token/holder-positions` | 10s | 不轮询（手动翻页） |
| `token/ohlcv-history` | 30s | 不轮询（切周期时重取） |

实现：`fetch(url, { next: { revalidate: N } })` —— Next.js 自带请求级缓存，同 URL 在 TTL 内只打一次上游，N 个浏览器共享。

### 4.4 预留 WS 的抽象

客户端统一走一个 hook：

```ts
useTokenStream(key, fallbackFetcher, { interval })
// PoC 实现：SWR 轮询
// 后续实现：连 /api/stream (SSE) ，服务端再连 wss://api.mobula.io
```

页面组件只认这个 hook，换实时方案时**页面代码零改动**。

---

## 5. 页面设计

### 5.1 列表页 `/`

**接口**：`POST /api/2/pulse`，**一次请求拿四个 view**（省掉 3 次往返）：

| view name | 配置 | 对应 FOMO tab |
|---|---|---|
| `trending` | `sortBy: fees_paid_5min`，filters: liquidity≥37500 / trades_1h≥100 | Trending |
| `new` | `model: "new"` | 新币 |
| `bonding` | `model: "bonding"` | Pre-graduated |
| `bonded` | `model: "bonded"` | Graduated |

公共参数：`assetMode: true`、`filterQuotes: true`、`chainId: ["solana:solana","evm:8453","evm:56"]`、`limit: 50`

**交互**：tab 切换纯前端（数据已全在手）；链筛选改 URL query → 重新请求。

**表格列**：Logo · Symbol/Name · Chain · Age · Price · 1h% · 24h% · MarketCap · Liquidity · Vol24h · Holders · Bonding进度条

字段映射见 `fomo_token_list_research.md` §2.4。

### 5.2 详情页 `/token/[chain]/[address]`

SSR 并行拉 `token/details` + `token/ohlcv-history`，其余客户端加载。

| 区块 | 数据源 | 说明 |
|---|---|---|
| Header | `token/details` | logo/name/symbol/price/24h%/socials/合约地址复制 |
| 指标网格 | `token/details` | MarketCap · FDV · Liquidity · Vol24h · Holders · Created · Bonding% |
| K 线图 | `token/ohlcv-history` | 周期切换 1m/5m/1h/1d，客户端重取 |
| 买卖对比条 | `token/details` | buys vs sells、buyers vs sellers、volumeBuy vs volumeSell |
| 持仓分布 | `token/details` | top10% / dev% / snipers% / insiders% / bundlers% |
| 安全面板 | `token/details.security` | buyTax/sellTax/isHoneypot/isMintable/renounced |
| Trades tab | `token/trades?mode=asset` | 5s 轮询，翻页 |
| Holders tab | `token/holder-positions` | 手动翻页，展示 PnL + labels |

字段映射见 `mobula_token_detail_api.md` §3.2 / §6.2 / §7.2。

---

## 6. 实施步骤

| # | 任务 | 产出 | 预估 |
|---|---|---|---|
| S0 | `create-next-app` 脚手架 + 深色主题 + 依赖安装 | 能跑的空壳 | 10 min |
| S1 | `lib/mobula.ts` + `lib/types.ts` + `lib/format.ts` + BFF route | `curl localhost:3000/api/mobula/pulse` 通 | 25 min |
| S2 | 列表页（SSR + TokenTable + 四 tab + 链筛选 + 轮询） | 列表页可用 | 45 min |
| S3 | 详情页骨架（Header + StatGrid + BuySellBar + 安全面板） | 静态数据全上屏 | 40 min |
| S4 | K 线图（lightweight-charts + 周期切换） | 图表能画 | 30 min |
| S5 | Trades / Holders 两个 tab（轮询 + 翻页） | 详情页完整 | 35 min |
| S6 | 联调打磨：loading/错误态、数字格式、列表→详情跳转 | 可演示 | 25 min |

**合计约 3.5 小时**，S0-S2 跑通即已能验证"接口可行"这一核心目标。

---

## 7. 验收标准（PoC 达标线）

1. `npm run dev` 起服务，浏览器打开 `/` **在 2 秒内看到真实代币数据**（SSR 首屏无白屏）
2. 四个 tab 数据各不相同，且分类语义正确（new 都是新币、bonded 都已毕业）
3. 列表每 5 秒自动刷新，价格/涨跌数字有变化
4. 点任意一行 → 进详情页 → 行情、K 线、Trades、Holders **四块都有真实数据**
5. 浏览器 Network 面板中 **没有任何直连 `api.mobula.io` 的请求**（全部经 `/api/mobula/*`），证明跨域方案成立
6. 页面源码 / 请求头中**搜不到 API key**
7. 连续开 3 个 tab 刷 5 分钟不出现 429（证明缓存策略有效）

---

## 8. 风险与应对

| 风险 | 应对 |
|---|---|
| demo 环境 1 RPS 限速 | §4.3 服务端短缓存；真要压测就申请免费 key（10K credits） |
| `pulse` 官方 OpenAPI 里没有，字段可能变 | TS 类型只声明用到的字段 + 全部可选，字段缺失不崩 |
| 某些链/代币字段缺失（如无 socials、无 holders） | 所有渲染点做空值兜底，显示 `—` |
| ohlcv 返回 80KB+ | SSR 时按 `from/to` 截取最近 N 根；客户端切周期才重取 |
| lightweight-charts 需 client-only | `dynamic(() => import(...), { ssr: false })` |

---

## 9. PoC 之后的演进方向

1. **接实时**：申请 Growth 计划 → 服务端连 `wss://api.mobula.io`（`pulse-v2` / `fast-trade` / `market-details`）→ 经 SSE 广播给浏览器，替换 §4.4 的 hook 实现
2. **补用户体系**：登录、Watchlist、我的持仓（`/api/2/wallet/positions`）
3. **自建热度算法**：用 `trendingScore*` / `feesPaid*` / `organic_*` 组合出自己的 trending 排序
4. **加 Redis 缓存层**：替换 Next.js 内存缓存，支撑多实例部署
5. **补社交层**：thesis 观点流、好友持仓（Mobula 不提供，需自研）
