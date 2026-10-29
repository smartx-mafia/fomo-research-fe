# Square Buy / Sell Activity

`GET /v1/social/square/feed` 的 `items[]` 现在支持 `type=2` Trade 卡片。接口字段以后端
[`social.md`](https://github.com/smartx-mafia/smartx-backend/blob/master/docs/contracts/social.md)
§6.3 为准；客户端不把 Trade 当 Opinion，也不从交易字段推导仓位或 PnL。

- `trade.side` 只有 `buy` / `sell`，对应绿色 Buy / 红色 Sell 标签。
- `trade.chain` 与 `trade.token_address` 是标的身份；Token 跳转必须使用这两个字段。
- `trade.token` 是可选完整元数据；`token.address === ""` 表示元数据不可用，显示地址缩写，不把 `decimals=0` 当成可信精度。
- `token_amount` 是已经按 decimals 换算的人类可读字符串；`usd` 是成交金额字符串。空串是不可用，不是零。
- `market_cap_usd`（可选）是成交发生时的市值；当前后端 TradeCard 尚未提供此字段，前端显示 `at — MC`，禁止用当前行情市值或 `usd/token_amount` 伪造历史市值。后端补齐后会显示 `at $8.10M MC` 这类文案。
- `SquareItem.sort_time` 用于 Feed 排序和未读，`trade.occurred_at` 只用于展示成交发生时间。
- `tx_hash` 的浏览器链接使用 `tx_chain`；`tx_chain` 为空时才回退到 `trade.chain`。
- `position_target_id` 只有平台成交已归入仓位周期时才有值；聪明钱交易为空，不允许拿它创建观点。
- `actor_type=user` 时读取 `actor` 并允许关注；`actor_type=smart_money` 时读取 `smart_money`，不展示用户关注按钮。
- `opinion` 对 Trade 卡片为 `null`；关注关系只对用户 actor 批量读取，Like 只对 Opinion 可用。

当前 Square 前端已完成 TypeScript normalizer、TradeCard、Smart Money / User actor 分支、成交数量/USD/时间/交易跳转、
无值降级和多值 `filters` query 编码。New Feed 默认不带 filters 表示全部；后续 Filter UI 应传重复 query key：
`filters=SQUARE_FILTER_BUY&filters=SQUARE_FILTER_SELL`，并使 cursor/refresh anchor 随筛选变化一起失效。

当前未实现的 PRD 能力仍保持关闭：Trade 与 Opinion 混合 Filter UI、Live/Pause 缓冲流、后端成交时 Market Cap 字段、
PnL Milestone 和官方置顶。Trade 卡片展示真实接口字段，不用占位数据补齐这些字段。


## 持仓小卡片与回扫状态

点击交易或观点的持仓区域按需加载持仓弹窗，关闭或切换账号后中止请求。平台用户使用原始周期标识；
聪明钱只采用 `actor_view` 明确给出的外部主体，共享钱包不推断主体，使用钱包身份查询。

聪明钱从 `/v2/smartmoney/positions/page` 精确查询选中的身份、实际链和 `token_address`，固定
`status=all&include_details=true&limit=100`。仅读取 `list[].status` 与平面字段、`detail`，
不混用旧全量快照结构。最多读取 5 页，并校验成员版本与游标；超限或同一优先状态存在多个
无法区分的轮次时明确报错，不任取一轮。状态优先级为 open、closed、pending。
交易历史仍读取 `/v1/smartmoney/new-position-trades`。`pending` 显示「待回扫确认」，
不解释成持仓中或已平仓，数量、成本和盈亏未知时显示 `—`。原有来源行继续展示来源已确认数值。

`observation.bought_usd` / `sold_usd` / `bought_amount` / `sold_amount` 独立显示为「已观测」买卖小计，
明确说明不代表完整历史累计、转账不计入。正式累计买入金额使用 `history_bought_cost`，不以剩余持仓成本
`accu_cost` 或已观测小计替代。客户端不推算成本和盈亏。

仅弹窗挂载且仓位为 `pending` 或 `observation.status=pending_source_refresh` 时每 10 秒重读持仓；
来源返回 `source_reported` 后停止，关闭弹窗后停止，不新增广场全局轮询。列表和交易历史独立取数，
缺少汇总不会抹掉已采集交易。
