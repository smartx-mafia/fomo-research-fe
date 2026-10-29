> **归档文档 —— 原样搬入，未逐句校订。**
>
> 来源：`web-embedded-harness` 仓库的 `CONTEXT.md`（归档时 HEAD `15670e5`），于 **2026-09-18** 迁入
> `fomo-research-fe/app/docs/harness/`。
>
> 正文**一个字未改**，为的是能与归档仓库逐行对照。代价是：其中关于 **Vite / `vite.config.ts` proxy /
> `import.meta.env.VITE_*` / `npm run dev` / dist 构建与部署**的描述**已不适用于本仓库**。
> 迁移后的现状、以及若干已被实测推翻的说法，一律以同目录的
> [`migration-notes.md`](./migration-notes.md) 为准；迁移方案见
> [`migration-spec.md`](./migration-spec.md)。
>
> ——以下为归档原文——

# Embedded Harness

真 Privy embedded 钱包在真浏览器里签名、走 SmartX 对外面的联调台，同时作为原生客户端接入 Fast Swap 的参考实现。

## Language

### 交易

**Swap**:
一笔由后端报价、组装、平台预签、广播的兑换，从源钱包的源资产换到目的钱包的目的资产。
_Avoid_: trade、订单、下单

**Intent（意图）**:
用户一次确认所表达的兑换要求（路线、资产、金额、滑点、钱包），由客户端生成的 `client_intent_id` 标识；一次确认只对应一个 intent，超时恢复时沿用，不换新。
_Avoid_: 请求、订单参数

**Route（路线）**:
源链 + 目的链 + side 的组合；只有后端 capabilities 声明开放的路线才可以用，客户端不得猜测启用。

**Side**:
路线的方向：buy（从现金资产买入）、sell（EVM 上卖出）、swap（币币兑换，Solana 上的卖出也是它）。
_Avoid_: 把「Solana 卖出」叫 sell

**Quote（报价）**:
只供展示的价格与费用估计，不建 swap、不锁钱包、不可签。
_Avoid_: 预估单、可签报价

**Revision（可签版本）**:
一个 swap 在某一时刻由后端准备好、带签名材料与签名期限的不可变版本；只有 preparation 为 READY 时才能签；过期只能 refresh 同一个 swap。
_Avoid_: 待签数据、prepare 结果

**Signed artifact（签名产物）**:
用户对某个 revision 的签名结果（Solana 是完整已签交易，EVM 是按 request 逐项的签名）；一旦产生必须先可靠保存，再上报。
_Avoid_: signature（单指一段签名时才用）

**Execution（执行上报）**:
把签名产物交给后端广播 / 执行这件事及其状态；ACCEPTED 只表示后端出口接受，UNKNOWN 表示结果不确定且禁止重签。
_Avoid_: submit、广播成功

**Outcome（结局）**:
后端根据两条链、Relay 与账务事实给出的 swap 最终结论。

**Completed（完成）**:
outcome 为 completed：源链与目的链都 CONFIRMED、Relay FILLED、账务 POSTED 且有实际到账金额。执行被接受、目的资产被观察到，都**不是**完成。
_Avoid_: 成交（指 ACCEPTED / OBSERVED 时）

### 钱包

**Source wallet / Destination wallet（源钱包 / 目的钱包）**:
由 Privy 钱包 id 指定的用户钱包；同一个 EVM embedded 钱包在各 EVM 链上是同一个 id。

**Cash asset（现金资产）**:
用户用来买入、卖出后回到的资产，固定为 Solana 上的 USDC；卖出（含 EVM 链上的卖出）的目的资产都是它。
_Avoid_: 稳定币、USDT

**Active swap（在途 Swap）**:
属于当前账户、outcome 尚未成为终态的 swap；打开页面时要把它们找回并由人决定是否续上。
_Avoid_: pending 单

**Sponsor（代付账户）**:
平台为用户支付 Solana 手续费与租金的账户，是平台预签中的一方。

**Platform presign（平台预签）**:
后端在交易交给用户之前已经加上的平台一方签名（如 Solana fee payer）；用户签名不得覆盖或改动它。

## Relationships

- 一个 **Intent** 至多产生一个 **Swap**
- 一个 **Swap** 有一个或多个 **Revision**，同一时刻只有一个当前 revision
- 一个 **Revision** 至多被签成一个 **Signed artifact**
- 一个 **Signed artifact** 通过一次 **Execution** 上报（重试沿用同一产物）
- 一个 **Swap** 最终有一个 **Outcome**；**Completed** 是其中一种

## Example dialogue

> **Dev:** "执行上报返回 ACCEPTED 了，UI 能显示成交吗？"
> **Domain expert:** "不能。ACCEPTED 只说明后端出口接受了这份签名产物。要等 outcome 为 completed，才叫完成。"

> **Dev:** "revision 过期了，我新建一个 swap 重来？"
> **Domain expert:** "不。未签的 revision 过期就 refresh 同一个 swap；intent 不变。"

## Flagged ambiguities

- 「预估」在 v1 时指 preview 接口；现在统一叫 **Quote**，且明确不可签。
- 「仓位补查」不再用来判定交易结果；判定只看 **Outcome**，仓位只是旁证。
