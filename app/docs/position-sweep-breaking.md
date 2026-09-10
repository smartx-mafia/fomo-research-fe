# Position / Sweep 破坏式更新

本次前端必须与后端 `OpinionCard.position: PortfolioPosition` 同步发布。
PRD及完整验收矩阵见[Square前端对接文档](https://github.com/smartx-mafia/smartx-backend/blob/master/docs/contracts/social-square-integration.md)，产品来源为[08-square Draft0.17](https://wjpvbd3lg9kg.jp.larksuite.com/wiki/L0N3w1obWi5T4OkGZxIjZYicp4g)。
旧三字段 position 和过渡 standard_position 不再兼容；后端若仍是旧版本，前端显式报告结构不匹配。

- Square 和 Opinion 详情共用卡片解析；Position 共用 Portfolio 的类型和 normalizer。
- token_ready=false 时不使用零值 token；资产身份始终来自 position.asset。
- 卡片只显示Symbol；Open显示Position Value与Unrealized PnL金额，不显示ROI；Closed显示Realized PnL金额与ROI，不显示市值/浮盈。ratio=0.1表示10%。
- Logo及完整静态元数据由Feed同批返回，Square已删除额外market请求。
- 已清仓卡片接受 shares_raw=0，保留周期累计/收益；缺价格/精度不显示成零。
- 社交 int64 在 JSON.parse 前转为字符串，路径、并发版本和状态保存完整精度。
- 升级前的未完成编辑恢复记录只迁移可无损转换的数字 ID，保留原幂等键。

最新后端已删除 `/v1/deposit-addresses` 和 `/v1/deposit-routes`。
Deposit页只从Portfolio.cash_balances派生路线：deposit_mode=sweep、deposit_enabled、balance_meets_minimum及可信amount_raw必须同时满足。
用户点击Refresh时发送force_refresh=true刷新五链；自动检查使用12秒缓存。选择代币后Create，Prepare获取真实完整余额并检查最低金额，
用户确认和签名后 Submit，再按同一 ID 查询进度。页面不自动扫链或未经确认签名。

Create 返回的 ID 会在后续 GET 前保存；GET 或 route 查询失败仍可恢复已知 sweep。
没有真实登录/签名 canary 时，单元和组件测试不能证明资金已在测试环境归集成功。

验收：Square Open/Closed字段互斥、Symbol/Logo同源，Opinion详情同形，超大ID点赞与编辑，
缺元数据与已清仓卡片；Deposit 的 route 展示、余额不足、Create 后 GET 故障恢复、
Prepare/签名/Submit/确认。回滚必须同步回退前后端版本。
