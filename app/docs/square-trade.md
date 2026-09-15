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
- 外部钱包直接使用 Feed 内的 `smart_money.display_name/avatar_url/handle/x_handle/source/source_url` 展示资料与来源；缺少资料时回退钱包地址，不额外补资料请求。来源链接只允许 HTTP(S)。
- `actor_type=user` 时读取 `actor` 并允许关注；`actor_type=smart_money` 时读取 `smart_money`，不展示用户关注按钮。
- `opinion` 对 Trade 卡片为 `null`；关注关系只对用户 actor 批量读取，Like 只对 Opinion 可用。

当前 Square 前端已完成 TypeScript normalizer、TradeCard、Smart Money / User actor 分支、成交数量/USD/时间/交易跳转、
无值降级和多值 `filters` query 编码。New Feed 默认不带 filters 表示全部；后续 Filter UI 应传重复 query key：
`filters=SQUARE_FILTER_BUY&filters=SQUARE_FILTER_SELL`，并使 cursor/refresh anchor 随筛选变化一起失效。

当前未实现的 PRD 能力仍保持关闭：Trade 与 Opinion 混合 Filter UI、Live/Pause 缓冲流、Trade Position Details、后端成交时 Market Cap 字段、
PnL Milestone 和官方置顶。Trade 卡片展示真实接口字段，不用占位数据补齐这些字段。

本地预览 `/square?lane=newest&mode=token` 读取测试后端真实 Feed。新交易沿用现有 30 秒未读检查，点击更新提示或 Refresh 后读取首屏；不额外建立交易流连接。
