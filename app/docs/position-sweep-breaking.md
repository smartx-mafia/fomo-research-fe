# Position / Sweep 破坏式更新

本次前端必须与后端 `OpinionCard.position: PortfolioPosition` 同步发布。
旧三字段 position 和过渡 standard_position 不再兼容；后端若仍是旧版本，前端显式报告结构不匹配。

- Square 和 Opinion 详情共用卡片解析；Position 共用 Portfolio 的类型和 normalizer。
- token_ready=false 时不使用零值 token；资产身份始终来自 position.asset。
- 仓位价值和收益读服务端快照。收益率为本轮总盈亏/累计买入，ratio=0.1 表示10%。
- 额外 market 请求只补 logo，不覆盖 Feed token 身份、名字、精度、价格或收益率。
- 已清仓卡片接受 shares_raw=0，保留周期累计/收益；缺价格/精度不显示成零。
- 社交 int64 在 JSON.parse 前转为字符串，路径、并发版本和状态保存完整精度。
- 升级前的未完成编辑恢复记录只迁移可无损转换的数字 ID，保留原幂等键。

Deposit 页 EVM Sweep 入口来自 GET /v1/deposit-addresses 的 EVM route + accepted_tokens。
Portfolio 不提供 EVM 归集余额；选择代币后 Create，Prepare 获取真实完整余额并检查最低金额，
用户确认和签名后 Submit，再按同一 ID 查询进度。页面不自动扫链或未经确认签名。

Create 返回的 ID 会在后续 GET 前保存；GET 或 route 查询失败仍可恢复已知 sweep。
没有真实登录/签名 canary 时，单元和组件测试不能证明资金已在测试环境归集成功。

验收：Square 卡片字段/市值/本轮收益率，Opinion 详情同形，超大 ID 点赞与编辑，
缺元数据与已清仓卡片；Deposit 的 route 展示、余额不足、Create 后 GET 故障恢复、
Prepare/签名/Submit/确认。回滚必须同步回退前后端版本。
