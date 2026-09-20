# 统一榜单用户与钱包详情：前端数据接入说明

更新日期：2026-09-17。本文描述当前工作区已经实现的代码，重点是 FOMO / PUMP 用户详情；不是后端完整接口契约，也不代表这些改动已部署到生产。

## 1. 接入方式概览

统一榜单提供身份引用，详情页根据身份选择接口。FOMO / PUMP 用户持仓由后端聚合，前端不会遍历其关联钱包重新查询、求和或拼接持仓。

| 榜单 `identity.type` | 详情组件 | 数据接口 | 范围 |
|---|---|---|---|
| `external_user` | `ExternalUserDetail` | `/v1/smartmoney/detail?identity_type=user&user_id=...`（身份头部）；`/v1/smartmoney/platforms/{platform}/users/{user_id}/holdings?chain=all`；`/v1/smartmoney/new-trades?subject_type=external_user&user_id=...`；`/v1/smartmoney/new-position-trades?subject_type=external_user&user_id=...&position_id=...` | FOMO / PUMP 用户的关联链钱包 |
| `wallet` | `WalletDetail` → `SmartMoneyProfile` | `/v1/smartmoney/detail?identity_type=wallet&namespace=...&wallet_address=...`（身份头部）；`/v1/smartmoney/holdings?chain=...&address=...` | 当前选择的单链钱包 |
| `smartx_user` | `SmartXUserDetail` | `/v1/users/{identifier}/portfolio` | 指定本站用户的账本组合 |

共同页面入口是 `/leaderboard/detail`，这是前端页面路由，不是后端 API。

`external_user` 与 `wallet` 两类身份的页头由 `SmartMoneyDetailHeader` 统一渲染，数据来自 `/v1/smartmoney/detail`（Optional 鉴权，前端不传 bearer）：头像、`display_name`、来源标签（含 logo）、X 账号与关注者数；`enabled === false` 时提示身份已停用。回包的 `wallets` 列表不展示（钱包身份即其自身，外部用户的关联钱包以持仓接口的 `wallets` 覆盖信息为准）。身份请求失败只在页头内提示并重试，不阻塞下方持仓与交易；资料缺失时名称回退为持仓 `pnl_windows` 的用户名（外部用户）或短地址（钱包）。

## 2. 从榜单到详情页

榜单读取 `/v1/leaderboard-new`，头像和名称通过 `leaderboardDetailHref(entry)` 生成同一个详情链接。

该接口为 Optional 档：登录后请求会带本站 JWT，回包顶层新增 `viewer_rank`（当前用户名次，未上榜为 0）、`viewer_profit_usd`（当前用户窗口盈亏，空串不可用）与 `participant_count`（本期参与排名总人数，可能大于上限 100 的 `count`，目前仅 SmartX 维度非零），榜单页据此在表格上方展示「我的排名 / 我的盈亏 / 参与人数」摘要。带过期 token 会返回 `400000 SYS_UNAUTHENTICATED`，前端清掉失效会话后按匿名重拉，不把整榜当失败。

### FOMO / PUMP 用户

以 FOMO 用户 `subject:53` 为例：

```text
前端页面：
/leaderboard/detail?type=external_user&id=subject%3A53&platform=fomo

后端请求：
GET /v1/smartmoney/platforms/fomo/users/subject%3A53/holdings?chain=all
```

映射规则：

- `id` 原样使用榜单的 `identity.id`，保留完整 `subject:` 前缀，不从钱包地址重新生成。
- `platform` 从榜单 `platforms` 转小写后选择，仅支持 `fomo`、`pump`。
- 同一条目同时包含 FOMO 和 PUMP 时，当前前端优先选择 `fomo`，只请求一次。
- 不支持的平台条目不生成外部用户详情链接。
- 链接用 `URLSearchParams` 编码；页面解析还原 ID 后，API 路径再用 `encodeURIComponent` 编码。

详情页使用 `useSearchParams` 读取参数，并由 `parseLeaderboardDetail` 校验。参数不完整时显示错误和返回链接，不发持仓请求。页面用 `Suspense` 包裹，支持静态导出后的直接访问与刷新，不需要新增动态路径重写。

返回链接为 `/leaderboard#unified`，榜单读取该 hash 后选中“统一榜单”。目前不会通过详情链接保存榜单原来的时间和维度筛选。

## 3. 请求、鉴权与刷新

API 封装是 `getPlatformHoldings(platform, userID)`，底层复用 `call()`：

| 项目 | 当前实现 |
|---|---|
| 地址 | 浏览器直接请求 `BUSINESS_API_BASE + API 路径`，不是经由 localhost 代理 |
| Base URL | 优先 `NEXT_PUBLIC_BUSINESS_API_BASE`，兼容旧变量；默认 `https://sm-test-api.smartx.io` |
| 方法 | GET |
| 登录凭据 | 该调用不传 `bearer`，不附加 Authorization |
| 追踪 | 每次请求生成 `x-request-id` |
| 业务成功 | HTTP 200 且信封 `code === 200`，并存在 `data` |
| SWR 缓存键 | `['platform-user-holdings', platform, userID]` |
| 定时刷新 | 配置 `refreshInterval: 60000`；未开启隐藏页或离线强制定时刷新 |
| 手动刷新 | 调用当前 SWR 的 `mutate()` |
| 错误重试 | `shouldRetryOnError: false`，提供手动重试；保留 SWR 默认的焦点/重连重验证行为 |
| 大整数 | `mapping_version` 在 JSON 解析前按精确整数字符串保留 |

当前平台持仓封装直接返回 `response.data`，没有额外的运行时结构校验或字段重算；TypeScript 类型声明不能验证实际回包。

## 4. 回包各部分如何使用

| 字段 | 页面用途 |
|---|---|
| `open` | “持仓中”列表，直接采用后端分类 |
| `closed` | “已清仓”列表，直接采用后端分类 |
| `list` | 类型中保留，但新版详情表格不再使用它 |
| `pnl_windows` | 顶部时间窗口盈亏卡片；同时取第一个非空 `username` 作为详情标题，缺失则显示用户 ID |
| `wallets` | 关联链钱包明细、链筛选选项及新鲜度提示 |
| `coverage` | 不等于 `complete` 时显示数据不完整提示 |
| `stale` | 为 true，或任意钱包 `stale=true` 时显示更新延迟提示 |
| `total_profit`、`realized_profit`、`total_profit_ratio`（顶层） | 当前不作为顶部卡片数据来源 |
| `mapping_version` | 保留在回包类型中；当前不用于缓存键或版本失效判断 |

链选项为 `all` 加上 `wallets`、`open`、`closed` 中出现的链，前端去重。切链只是本地过滤 `row.chain`，仍然只请求 `chain=all`，不会发新的单链用户请求。

持仓中/已清仓的数量显示当前链过滤后的条数。前端不按余额重新分类、不重新聚合，也不再次排序。跨链 Token 展开状态使用链和 Token 地址区分，避免同地址不同链互相影响。

## 5. 顶部盈亏卡片

组件为 `SmartMoneyPnlSummary`，与 GMGN 钱包详情复用。

- 默认窗口是 `all`，提供 `1d / 7d / 30d / all`。
- 选中窗口后，在 `pnl_windows` 中寻找同名 `window`。
- “总盈亏”使用该项 `total_profit`；“已实现盈亏”使用该项 `realized_profit`。
- 切换时间仅切换卡片取值，不请求新接口，也不按时间过滤持仓表格。
- 切换链也不改变卡片：卡片始终为全链用户统计，页面已有范围说明。
- 缺失窗口或金额显示 `—`，不回退为顶层金额、不补零。

因此，榜单金额、顶部卡片、当前持仓列表的合计并不是前端强制保持相等的三个值。排查差异需要核对窗口、数据范围与采集时间，不能直接用行合计覆盖卡片。

## 6. 持仓表格字段映射

FOMO / PUMP 使用共享的 `SmartMoneyHoldingsTable`，与单钱包详情共用布局。`PlatformHolding` 继承 `SmartMoneyHolding` 并保留平台特有字段。

| 展示 | 数据 / 计算 | 说明 |
|---|---|---|
| Token 主标识 | `symbol ?? name ?? 短地址` | 当前使用空值合并；空字符串不会自动回退 |
| 名称 / 地址说明 | `name ?? token_address` | 主标识下方文本 |
| Token Logo | `logo` | 浏览器直接加载 HTTP(S) 图片；失败回退为标识首字符 |
| 所属链 | 行级 `chain` | 全链表格仍展示每条持仓的实际链 |
| 发射台 | `launchpad` | 空值显示 `发射台 —` |
| 风险标记 | `is_honeypot` | 仅真值显示标记；缺失或 null 不代表已确认安全 |
| 平均买入市值 | `avg_cost_market_cap_usd` | 持仓中显示 `Avg.entry`；缺失显示 `—` |
| 持仓价值 | `usd_value` | 持仓中列表第二列主值 |
| 已清仓收益 | `total_profit` | 已清仓列表第二列主值 |
| ROI | `total_profit / history_bought_cost × 100%` | 生涯累计买入成本口径；不直接使用 `roi` 或 `total_profit_pnl` |
| 持仓量 | `balance` | 只在持仓中列表展示；已是十进制数量，不再除以 `10^decimals` |
| 已实现盈亏 | `realized_profit` | 金额直接展示 |
| 已实现盈亏比例 | `realized_profit_pnl × 100%` | 直接使用后端比例，不自行选择分母 |
| 未实现盈亏 | `unrealized_profit` | 不用 `usd_value - cost` 重算 |
| 未实现盈亏比例 | `unrealized_profit_pnl × 100%` | 直接使用后端比例 |
| 总盈亏 | `total_profit` | 直接展示，不由前端相加覆盖 |
| 最近活跃时间 | `last_active_at` | 已清仓条目展示，Unix 秒转本地时间 |

金额和比率运算使用 `exact-decimal` 中的十进制字符串 / BigInt 工具；普通金额最多展示 2 位小数，持仓量最多 4 位，价格最多 12 位。ROI 使用 `holdingRoi()` 四舍五入至两位百分数，买入成本缺失、非正或输入非法时显示 `—`。

`Avg.entry` 的紧凑显示沿用 `fmtUsd`，FDV 使用行情数值及 `fmtCompact`，因此不能把“持仓精确计算”理解为所有展示格式均采用同一数值实现。

接口中的 `cost`、`accu_cost`、`accu_amount`、`avg_cost_price`、`price`、`wallet_count` 等仍可存在，但当前共享主表不会为它们各增加独立列。`roi` 与累计买入成本 ROI 的口径不能混用。

## 7. 展开持仓时展示什么

点击一行，展开共享 `HoldingSummary`：

| 展示 | 来源 |
|---|---|
| 当前持仓价值 | `usd_value` |
| 总盈亏 | `total_profit` |
| 当前总市值（FDV） | 独立行情查询的 `market_cap_diluted` |
| 累积买入 | `history_bought_cost` |
| 买入均价 | `avg_bought_price` |
| 平均买入市值（已清仓） | `avg_cost_market_cap_usd` |
| 累积卖出（已清仓） | `history_sold_income` |
| 累积卖出份额（已清仓） | `history_sold_amount` |
| 卖出均价（已清仓） | `history_sold_income / history_sold_amount`，精确计算至 12 位小数 |

FDV 由 `SmartMoneyTokenFdv` → `fetchTokenMarket(chain, tokenAddress)` 获取，只有展开时挂载。行情查询把 `sol` 转成 `solana`，Solana 地址保持大小写，其他链地址转小写，并核对行情返回的链与地址。没有可用行情时显示 `—`。

外部用户不传单钱包 `address` 给共享表格，因此不会触发 `TokenHistory` 的钱包交易请求；展开区改为展示该仓位的用户聚合交易历史（见 §8）。

## 8. 用户级交易（2026-09-17 接入）

两个接口都只读后端已落库的账本，用户模式禁止传 `chain` / `address`，因此前端不按链拆分请求；`position_id` 取持仓行原样回传的 `position_id`（实测等于 `chain:token_address`，但格式属于后端，前端只在字段缺失时才回退拼装），不是链筛选参数。封装在 `app/src/api/platform-trades.ts`，底层同样是 `call()`，不传 `bearer`。

### 最近交易 `GET /v1/smartmoney/new-trades`

| 项目 | 当前实现 |
|---|---|
| 请求 | `subject_type=external_user&user_id={完整 subject id}`，游标非空时追加 `cursor` |
| 分页 | 固定每页 50 条；`useSWRInfinite` + “加载更多”，SWR 缓存键前缀 `['platform-user-trades', userID, cursor]` |
| 展示 | 持仓/交易双 Tab 的“交易”页；逐腿平铺，不去重，展示时间、类型、Token、链、来源钱包、数量、计价、成交价、金额与 Tx |
| 覆盖提示 | 任一页 `wallets[].coverage !== 'complete'` 时提示“部分钱包的交易覆盖不完整” |
| 错误 | 失败显示错误与“重试”（重置回第一页）；错误码为 `100110 BIZ_SMDETAIL_INVALID_PARAM` 且**当前不在第一页**（即这次请求带了游标）时，自动从第一页重拉一次。第一页自身返回 100110 是参数非法，不自动重试 —— 这个码同时覆盖“游标过期”和“参数非法”，只有“带了游标”才能断定是前者，否则会成环 |

### 单仓位交易历史 `GET /v1/smartmoney/new-position-trades`

| 项目 | 当前实现 |
|---|---|
| 请求 | `subject_type=external_user&user_id=...&position_id={持仓行的 position_id 原样回传}` |
| 分页 | 接口不分页，一次返回本地账本已采集的全部记录 |
| 挂载时机 | 展开持仓行时才请求，SWR 缓存键 `['platform-position-trades', userID, positionID]` |
| 展示 | 时间、类型、钱包、数量、计价、成交价、金额、轮次与 Tx；`legs > 1` 标 `×N`，`round_close` 标“清仓” |
| 轮次 | 轮次由后端按 `chain+wallet_address+token_address` 独立编号；页面按行展示钱包与 `#round`，并注明同一轮次号可能来自不同钱包，不做跨钱包合并或加总 |
| 覆盖提示 | `coverage !== 'complete'` 时提示仅展示本地已采集记录 |

两个列表都不做统计：行数被回填上限或钱包覆盖影响，盈亏一律用持仓接口的现成字段。

## 9. 数据异常与已知限制

### 完整性和估值

- `coverage`、`stale` 与估值一致性分别处理；持仓完整不意味着估值公式必然自洽。
- `valuation_consistent === false` 时，展开区显示“估值数据存在差异，金额按来源展示”。当前列表行没有单独的异常徽标。
- 现有回包样本的 `valuation_consistent` 也出现过 null；前端只对显式 false 提示。当前公共类型仍声明为可选 boolean，存在类型与实际 nullable 回包需对齐的缺口。
- 平台接口空字符串表示不可用的金额，不应当作零；数字字符串 `"0"` 则正常显示零。
- `snapshot_at` 是采集时间，不能替代交易时间；当前外部用户共享主表不再单列每条持仓的采集时间，关联钱包明细保留其 `snapshot_at`。

### 错误和旧数据

首次请求失败显示错误与重试，不把失败解释成成功空榜。错误携带 `traceID` 时展示供排查。刷新失败但 SWR 仍有旧数据时，错误和旧数据会同时显示；当前没有额外的“旧数据”专用标签。

### 尚未接入的能力

- 当前详情页未使用 `pnl_windows.avatar_url` 展示用户头像；榜单头像来自榜单的 `profile.avatar_url`。
- 不会使用 `identity_revision` / `mapping_version` 在前端校验聚合范围是否跨版本变化。
- 没有运行时 schema 校验；若后端缺少 `open/closed`，当前代码会按空数组处理，可能显示为空持仓，需排查接口版本。

### 长 Token 名称布局问题

当前共享 Token 列缺少有效宽度上限。超长 `symbol` 可撑宽自动布局表格，使金额列被挤到右侧；已有 `truncate` 本身不能解决没有宽度约束的问题。

此前 `subject:53` 的 Solana Token `QmCNH8vJaZcY2rwXLDM73tUqJ2d4HWkPeqeGht46g9a` 已复现此问题。本文记录的是已确认的问题，当前文档编写不包含该布局修复。

## 10. GMGN 与 SmartX 的区别

### GMGN 钱包

链接包含 `type=wallet`、`namespace`、`address` 和一个或多个重复的 `chain` 参数。至少有一条具体链才可进入，`all` 不作为具体链使用；默认选第一条链。

切链会重新挂载 `SmartMoneyProfile`，请求：

```text
GET /v1/smartmoney/holdings?chain={chain}&address={address}
GET /v1/smartmoney/trades?chain={chain}&address={address}
```

其中持仓配置每 10 秒刷新；最近交易在组件挂载时就会请求，不是等点击交易 Tab 才请求。展开 Token 后才请求：

```text
GET /v1/smartmoney/token-trades?chain={chain}&address={address}&token_address={token}&limit=50[&cursor=...]
```

`namespace` 用于详情身份描述和参数校验，不传入上述旧接口。钱包榜单可能是多链合计，而这里展示的是当前单链，页面已注明范围。

### SmartX 用户

以 URL 中的用户 `id` 调用 `getUserPortfolio(id)`，不替换为当前登录用户。每 60 秒刷新，底层经 `normalizePortfolio` 做结构解析。

当前详情仅展示 `positions`：数量用 `shares_raw + decimals` 转换；市值、成本、已实现、未实现分别使用 `market_value_usd`、`cost_basis_usd`、`realized_pnl_usd`、`unrealized_pnl_usd`。这一路使用独立表格，不是 FOMO/PUMP 的 `SmartMoneyHoldingsTable`。

## 11. 代码位置与验证入口

以下路径均相对仓库根目录：

| 文件 | 职责 |
|---|---|
| `app/src/components/UnifiedLeaderboardView.tsx` | 榜单头像、名称的详情链接 |
| `app/src/lib/leaderboard-detail.ts` | 详情链接生成、身份参数解析 |
| `app/src/app/leaderboard/detail/page.tsx` | 静态详情壳页与参数入口 |
| `app/src/components/LeaderboardDetailView.tsx` | 三类身份分流、外部用户持仓/交易双 Tab、链筛选及完整性提示 |
| `app/src/api/smartmoney-detail.ts`、`app/src/components/SmartMoneyDetailHeader.tsx` | `/v1/smartmoney/detail` 身份详情 API 与统一页头 |
| `app/src/api/platform-holdings.ts` | FOMO/PUMP 持仓 API 及回包类型 |
| `app/src/api/platform-trades.ts` | FOMO/PUMP 用户级最近交易与单仓位交易历史 API |
| `app/src/api/envelope.ts`、`app/src/config.ts` | 公共请求、业务信封与环境地址 |
| `app/src/components/SmartMoneyProfile.tsx` | 共享 Token、持仓表格、展开摘要、钱包与用户级交易表 |
| `app/src/components/SmartMoneyPnlSummary.tsx` | 顶部窗口盈亏卡片 |
| `app/src/components/SmartMoneyTokenFdv.tsx` | 独立 FDV 行情查询 |
| `app/src/lib/holding-roi.ts`、`app/src/lib/average-sell-price.ts` | 精确 ROI、卖出均价计算 |
| `app/src/api/smartmoney.ts`、`app/src/api/user-portfolio.ts` | GMGN 钱包及本站用户接口 |

相关测试包括 `platform-holdings.test.ts`、`platform-trades.test.ts`、`leaderboard-detail.test.ts`、`LeaderboardDetailView.test.tsx`、`UnifiedLeaderboardView.test.tsx` 和 `LeaderboardTabs.test.tsx`，覆盖完整 ID 编码、身份分流、链切换、后端分类、ROI 口径、用户级交易分页、单仓位 `position_id` 原样回传，以及过期游标自动重拉（含首页 100110 不成环）。

排查顺序：先核对页面身份和 Network 实际请求，再比较 `open/closed` 原始字段与页面数值；交易列表核对 `subject_type`/`position_id` 参数与 `wallets[].coverage`；收益差异核对窗口、采集时间及 `valuation_consistent`；只看到 Token 列时优先检查长名称导致的表格溢出。
