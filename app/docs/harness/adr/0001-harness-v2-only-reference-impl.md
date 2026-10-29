> **归档文档 —— 原样搬入，未逐句校订。**
>
> 来源：`web-embedded-harness` 仓库的 `docs/adr/0001-harness-v2-only-reference-impl.md`（归档时 HEAD `15670e5`），于 **2026-09-18** 迁入
> `fomo-research-fe/app/docs/harness/`。
>
> 正文**一个字未改**，为的是能与归档仓库逐行对照。代价是：其中关于 **Vite / `vite.config.ts` proxy /
> `import.meta.env.VITE_*` / `npm run dev` / dist 构建与部署**的描述**已不适用于本仓库**。
> 迁移后的现状、以及若干已被实测推翻的说法，一律以同目录的
> [`migration-notes.md`](./../migration-notes.md) 为准；迁移方案见
> [`migration-spec.md`](./../migration-spec.md)。
>
> ——以下为归档原文——

# Harness 只走 Fast Swap v2，并作为原生端的参考实现

2026-09-17 起，本仓的交易线路整体切到 Fast Swap v2（`/v2/swaps`），v1（`/v1/meme/trades*`、`/v1/meme/wallets/delegation/*`、`sign_kind` 那一套）连同测试与文档**全部删除，不留开关也不留兼容层**。做出这个决定时后端 master 仍注册着 v1，fastswap 模块 README 也写着「不是旧链路的替代，旧链路一行不改」——所以删 v1 是本仓单方面的决定，不代表后端已经下线 v1。需要对照 v1 时，从 git 历史（检查点 `474c2dd`）找回。

同时，页面的定位从「只走通正常路径的联调台」改成**原生端接入 v2 的参考实现**：签前七条核对、Solana 解码与平台预签验签、EVM 批次边界复核、签名产物先落盘再上报、幂等键重发、在途恢复、`/refresh`、签名锁、§9 计时与 `/telemetry` 全部实现，并配了五个故障注入开关，用来在真链上复现契约 §9 的恢复场景。代价是页面复杂度明显上升；没选「只走正常路径」，是因为 v2 相对 v1 真正新增的就是幂等与恢复，不验这些等于没验 v2。

## Considered Options

- **v1 / v2 并存，加开关**：能对照，但两条线共用钱包锁，开关一漏就在同一个钱包上跑出两条语义不同的交易；且不考虑留存是对齐会话的明确要求。
- **只做正常路径的联调台**：成本低，但测不到幂等键、恢复、过期刷新，而这些正是 v2 的契约重点。
- **完整照抄 App 契约做成可复用 SDK**：超出联调台的本分；契约 §10 也明说 App 不应从 Web 实现推断接口。
