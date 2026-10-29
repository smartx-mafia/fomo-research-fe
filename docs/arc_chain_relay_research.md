# Arc 链 & Relay.link 支持情况调研

> 调研日期：2026-09-20
> 调研目标：搞清 Circle 的 Arc 链（docs.arc.io）与标准 EVM 的差异，以及 relay.link 对该链的跨链支持程度，判断我们前端接入需要改什么。
> 结论先行：**Arc 主网已上线（chainId 5042），Relay 已全量支持（含原生/ERC-20 USDC、跨 VM、跨链 call），实测 Base↔Arc 1–6 秒到账、费率约 0.16%（USDC↔USDC）。**接入的真正成本不在 Relay，而在 **Arc 的 USDC 双精度（18 / 6）、20 Gwei gas 下限静默丢单、原生转账可 revert** 这三条 EVM 差异。

---

> **2026-09-20 后端侧复核与订正**（证据见后端仓
> `docs/research/2026-09-20-arc-chain-onchain-facts.md`，方案见
> `docs/plan/2026-09-20-arc-chain-onboarding.md`）：
>
> 1. **本文 §3.1 与 §4 第 8 条「没有 multicall3」是错的。** 空的是 Relay **链配置里那个字段**，
>    不是链上没有 —— 规范地址 `0xca11bde05977b3631167028862be2a173976ca11` 上有 3,808 字节的
>    Multicall3，主网与测试网都有。批量读余额不需要降级方案。
> 2. **§1.3 把 `0xccc88a9d…315be` 标成「v3 approvalProxy，当前报价不走」，实测报价确实走它。**
>    Arc meme 币的卖出报价里，approve 的 spender 与 deposit 的 `to` 都是这个地址，
>    选择器 `0xf9e4bab4`。后端仓把同一个地址叫 `relayERC20Router`。
> 3. **§9 第 9 条「联调只能主网」比原文更强**：Arc 测试网上 Calibur 实现合约与 Relay v2
>    depository 都**没有部署**，不只是 Relay 没有测试网环境。
> 4. **§4 的第 2、3、6 条不是前端责任**：精度口径的入账基准在后端账本；Arc 侧交易由 Relay 的
>    solver 发，20 Gwei 下限兜底不归我们；确认策略在后端的观察器与对账。前端只做显示。
> 5. **Arc 的 meme 生态已实测**：上线首日 DEX 成交 $410.8M，其中 82% 来自 meme 发射台；
>    Codex 索引 Arc、Alchemy 支持 Arc 主网（Token/Transfers API）。

## 0. 关键结论速查

| 问题 | 结论 |
|---|---|
| Arc 主网上线了吗 | 已上线。chainId **5042**，实测高度 2179 万+，平均出块 **0.507s** |
| 原生 gas 币 | **USDC**（不是 ETH），18 位小数 |
| Relay 支持吗 | **支持，且是全功能**：bridge / swap / 跨链 call 都可用，`tokenSupport: "All"` |
| Relay 走哪套合约 | **Relay Protocol v2**，depository `0x4cD00E387622C35bDDB9b4c962C136462338BC31` |
| 跨链耗时 | 报价 `timeEstimate`：Base→Arc **1s**（10万 USDC 时 6s），Arc→Base **2s** |
| 单笔容量 | Base→Arc solver `capacityPerRequest` ≈ **1,366,622 USDC** |
| 最大坑 | USDC 18 位 / 6 位双接口（**这条归后端账本**）；maxFeePerGas < 20 Gwei 交易被**静默丢弃**、原生转账可能 revert（**这两条归 Relay 的 solver，我们不在 Arc 上发交易**）|
| viem 支持 | `viem@2.56.0` 有 `arc` 定义，但 **`rpcUrls.default.http` 是空数组**，必须自己补 |
| Relay 测试网 | **没有 Arc 测试网**（`api.testnets.relay.link` 仅 sepolia / base-sepolia），联调只能主网小额 |

⚠️ 文档 `https://docs.arc.io/llms.txt` 里仍写 "Arc is currently available on Testnet only"，**该表述已过期**，与 `connect-to-arc` 页和链上实测矛盾，以后者为准。

---

## 1. Arc 链基本信息

Arc 是 Circle 推出的 L1，定位"可编程货币"，USDC 作为原生 gas 币，亚秒级确定性终局，EVM 兼容（Osaka EVM 基线）。

### 1.1 网络参数

| | 主网 | 测试网 |
|---|---|---|
| Chain ID | **5042** | **5042002** |
| RPC | `https://rpc.mainnet.arc.io` | `https://rpc.testnet.arc.io` |
| 备用 RPC | `rpc.blockdaemon.mainnet.arc.io`<br>`rpc.drpc.mainnet.arc.io`<br>`rpc.quicknode.mainnet.arc.io` | 同构（`*.testnet.arc.io`） |
| WSS | `wss://rpc.blockdaemon.mainnet.arc.io/websocket`<br>`wss://rpc.quicknode.mainnet.arc.io` | `wss://rpc.testnet.arc.io` |
| 浏览器 | `https://explorer.arc.io` | `https://explorer.testnet.arc.io` |
| 原生币 | USDC（18 位） | 同 |
| 测试币 | — | `https://faucet.circle.com`（选 Arc Testnet） |

### 1.2 链上实测（2026-09-20）

```
eth_chainId      -> 0x13b2 (5042)
eth_blockNumber  -> 0x14c9b54 (21,798,100+)
eth_gasPrice     -> 0x4b6ba30ff (~20.25 Gwei)
最近 10000 块平均出块时间 -> 0.507 s
最新块 baseFee   -> 20.00 Gwei（贴着协议下限）
gasLimit         -> 30,000,000
21000 gas 转账成本 -> 0.000420 USDC
```

### 1.3 关键合约地址（主网）

| 合约 | 地址 | 说明 |
|---|---|---|
| USDC（ERC-20 接口） | `0x3600000000000000000000000000000000000000` | **6 位小数**，与原生余额同一份钱；链上无 wrapped USDC |
| 原生 USDC 系统 emitter | `0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE` | EIP-7708 Transfer 日志源，**18 位** |
| EURC | `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1` | 6 位 |
| USYC | `0x8a5D989Bbb96929F689B0200f435f53dA42bF490` | 代币化货基份额，需 allowlist |
| CCTP TokenMessengerV2 | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | CCTP domain = **26** |
| CCTP MessageTransmitterV2 | `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` | |
| Relay v2 depository | `0x4cD00E387622C35bDDB9b4c962C136462338BC31` | Relay 跨链入金合约 |
| Relay v3 erc20Router | `0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f` | 配置中存在，当前报价不走 |
| Relay v3 approvalProxy | `0xccc88a9d1b4ed6b0eaba998850414b24f1c315be` | 同上 |

---

## 2. Arc 的 EVM 差异（对接必读）

来源：`https://docs.arc.io/arc/references/evm-differences`，按踩坑概率排序。

### 2.1 USDC 双接口、双精度 —— 最容易出钱的坑

原生余额 **18 位**，ERC-20 接口 `0x3600…0000` 是**同一份余额**的 **6 位**视图，两者差 `10^12`。

- 入账 / 对账一律用 18 位原始值；用 6 位值入账会**截断丢钱**。
- 展示原生值时除以 `10^12` 转成人类可读 USDC。
- **绝不能**在同一段池子 / LTV 数学里混用 `msg.value` 与 `USDC.balanceOf()`。
- 把"原生 USDC"和"ERC-20 USDC"做成交易对的流动性池在 Arc 上是无意义的——它们是同一个资产。

### 2.2 maxFeePerGas 下限 20 Gwei —— 静默丢单

协议最低 baseFee = 20 Gwei。**`maxFeePerGas` 低于 20 Gwei 的交易被 mempool 静默丢弃：没有回执、没有报错、永不上链。**

- 发交易前强制兜底 `maxFeePerGas >= 20 Gwei`，不能裸信 RPC 估算。
- 前端要给"发出去但永远查不到回执"加超时分支——在 Arc 上这通常是被丢了，不是 pending。
- 下一块的 baseFee 写在父块 header 的 `extra_data` 里；baseFee **支付给出块者而非销毁**。

### 2.3 原生转账可能 revert（标准 EVM 不会的情况）

| 场景 | 行为 |
|---|---|
| 向 `0x0` 转非零值 | revert `"Zero address not allowed"`（零值转账则成功） |
| 销毁 / 转给已 selfdestruct 的账户 | revert（禁止 burn） |
| 转入或转出**黑名单地址** | revert，且**已消耗的 gas 不退**，交易仍被打包 |
| 向 precompile 地址转值 | revert |
| 向无代码地址（`EXTCODESIZE == 0`）转值 | 成功，并发 `Transfer` 日志 |

→ "给合约转原生币必然成功"这个 DeFi 常见假设在 Arc 上不成立。前端错误提示要区分"余额不足"和"合规/黑名单拒绝"。

### 2.4 原生转账会发事件（EIP-7708）—— 索引会双计

标准 EVM 上原生转账不发日志，Arc 会。**两个 emitter，索引必须按 emitter 区分，否则一次 ERC-20 `transfer()` 会被记两遍**（它同时触发两个 emitter 的日志）。

| 流 | Emitter | 事件 | 精度 |
|---|---|---|---|
| 原生 USDC（系统，EIP-7708） | `0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE` | `Transfer` | 18 |
| ERC-20 USDC（NativeFiatToken） | `0x3600000000000000000000000000000000000000` | `Transfer` | 6 |

- topic0 均为标准 `Transfer` 签名 `0xddf252ad…3b3ef`。
- 纯原生转账只发系统日志。
- **gas 扣费不发日志**，成本要从 receipt 自行推算。
- 早期区块（系统 emitter 启用前）用的是 `0x1800…0000` 的 `NativeCoinTransferred/Minted/Burned` 事件，做全量历史索引时要处理这个切换点。

### 2.5 其他执行层差异

- **不支持 EIP-4844 blob 交易**，type-3 交易被 mempool 拒绝。
- `PREVRANDAO` **恒为 0** —— 链上无随机源，任何依赖它的逻辑要改。
- `SELFDESTRUCT` 遵循 EIP-6780 + 上述原生转账规则；成功迁移余额会发 EIP-7708 `Transfer` 日志。
- withdrawals（EIP-4895）恒为空；`parentBeaconBlockRoot` 返回父执行块 hash，无 beacon-roots 合约。
- **区块时间戳非严格递增**：秒级粒度 + 亚秒出块 ⇒ 相邻块可能同戳。**排序只能用 block number**，不能假设 `block.timestamp` 递增。
- **确定性终局**：交易打包即 final，链下系统 1 个确认即可动作，不需要等多确认。
- 支持 **EIP-7702**（set-code）、**EIP-2935**（历史区块 hash）。Solidity / Foundry / Hardhat / viem / ethers 原样可用。

---

## 3. Relay.link 对 Arc 的支持

### 3.1 链配置（`GET https://api.relay.link/chains`，实调）

```json
{
  "id": 5042, "name": "arc", "displayName": "Arc",
  "httpRpcUrl": "https://rpc.mainnet.arc.io",
  "explorerUrl": "https://explorer.arc.io",
  "depositEnabled": true, "disabled": false,
  "tokenSupport": "All", "vmType": "evm", "tags": ["New"],
  "currency": { "id": "usdc-arc", "symbol": "USDC",
                "address": "0x0000000000000000000000000000000000000000",
                "decimals": 18, "supportsBridging": true },
  "erc20Currencies": [ { "id": "usdc",
                "address": "0x3600000000000000000000000000000000000000",
                "decimals": 6, "withdrawalFee": 5 } ],
  "protocol": { "v2": { "chainId": "arc",
                "depository": "0x4cD00E387622C35bDDB9b4c962C136462338BC31" } }
}
```

要点：

- Arc 在 Relay 里**注册了两个 USDC 币种**：`usdc-arc`（原生 `0x0`，18 位）和 `usdc`（ERC-20 `0x3600…`，6 位）。选错只是多一笔 approve，不会算错账，但前端要固定策略。
- 走 **Protocol v2 depository**，不是旧的 relayReceiver（该字段为空）。
- `multicall3` 字段为空 —— **但这只是 Relay 没填，链上是有的**（规范地址 `0xca11bde0…ca11`，3,808 字节，主网与测试网都有）。批量读余额照常可用，不需要降级。
- **Relay 测试网环境没有 Arc**：`api.testnets.relay.link/chains` 只返回 `sepolia` 和 `base-sepolia`。

### 3.2 路由实测（`POST https://api.relay.link/quote`）

全部返回了可执行交易，无路由缺失：

| 路由 | 输入 | 输出 | timeEstimate | 费用构成 |
|---|---|---|---|---|
| Base USDC → Arc 原生 USDC | 10 | 9.96342 | 1s | service 0.036 + relayerGas 0.000579 |
| Base USDC → Arc 原生 USDC | 1,000 | 998.379 | 1s | service 1.620 + gas 0.000612（**0.16%**） |
| Base USDC → Arc 原生 USDC | 100,000 | 99,839.98 | 6s | service 160.02 + gas 0.000612（**0.16%**） |
| Arc 原生 USDC → Base USDC | 10 | 9.95593 | 2s | service 0.040 + relayerGas 0.004068 |
| Arc USDC → Ethereum ETH | 100 | 0.03875 ETH | 4s | service 0.2189 + gas 0.0080（跨币种 swap） |
| Solana USDC → Arc USDC | 10 | 9.962144 | 1s | 跨 VM 正常 |
| BSC BNB → Arc USDC | 0.1 BNB | 74.68 USDC | 1s | 以 BNB 计费 |

费率结构：`relayer = relayerService + relayerGas`。USDC↔USDC 大额时 service 费约 **0.16%**，小额时被固定成本抬高（10 USDC 时综合 ~0.37%）。Arc 侧 gas 极低（单笔 ~0.0004–0.004 USDC）。

### 3.3 容量

```
GET /config/v2?originChainId=8453&destinationChainId=5042&currency=usdc
-> solver.balance            1,708,277 USDC
   solver.capacityPerRequest 1,366,622 USDC
   supportsExternalLiquidity false
   enabled                   true
```

单笔百万级以内不用担心流动性；`supportsExternalLiquidity: false` 表示超额时不会回退到官方桥通道，只能拆单。

### 3.4 交易形态（决定前端要签几次）

**Arc 作为源链、用原生 USDC（`0x0`）：单笔 deposit，无需 approve**

```
to    0x4cD00E387622C35bDDB9b4c962C136462338BC31   (v2 depository)
value 10000000000000000000                         (10 USDC, 18 位)
data  0x49290c1c…
check GET /intents/status?requestId=0x…
```

**Arc 作为源链、用 ERC-20 接口（`0x3600…`）：approve + deposit 两笔**

```
1) approve  -> 0x3600…0000  data 0x095ea7b3…(spender = depository)
2) deposit  -> 0x4cD00E38…  value 0  data 0xe8017952…
```

→ **建议：Arc 出金一律用原生 `0x0` 形态，省一笔签名和一次等待。**

**Base 作为源链入金 Arc**：`approve` + `deposit` 两步（ERC-20 USDC 常规流程）。

### 3.5 跨链 call

带 `txs` 参数（在 Arc 上执行任意 calldata）的报价**正常返回**，说明支持"从 Base 一笔交易打钱到 Arc 并直接调目标合约"。如果我们要做"外链直接买 Arc 上的币"，这条路是通的。

---

## 4. 对我们前端的影响与落地清单

| # | 事项 | 说明 |
|---|---|---|
| 1 | **viem chain 定义要自己补** | `app/package.json` 用的是 `viem@^2.56.0`。`viem/chains` 里 `arc` 存在，但 `rpcUrls.default.http` 是**空数组**，直接用会静默连不上；`arcTestnet` 的 RPC 还指向旧域名 `*.arc.network`（文档现用 `*.arc.io`）。→ 自建 chain 常量，显式写 RPC + explorer，不要裸 import。 |
| 2 | **精度口径统一** | 余额 / 成交额 / 盈亏一律以 18 位原生口径为准，显示时除 `10^12`；与后端对账的字段明确标注精度，禁止用 6 位值做入账基准。 |
| 3 | **发单强制 gas 兜底** | `maxFeePerGas >= 20 Gwei`；并为"发出去查不到回执"加超时 + 重发路径。 |
| 4 | **交易历史按 emitter 过滤** | 自建索引时区分 `0xffff…FFfE`（18 位）与 `0x3600…`（6 位），否则 ERC-20 转账双计。 |
| 5 | **错误分支补"合规拒绝"** | 黑名单 / 零地址 revert 不是"余额不足"，要单独提示。 |
| 6 | **确认数可以设 1** | 确定性终局，不需要等多确认，UI 可以直接按 1 个确认判成功。 |
| 7 | **Relay 接入用原生币形态** | 源币填 `0x0000…0000`（18 位）省 approve；目标币按业务选 `0x0` 或 `0x3600…`。 |
| 8 | ~~没有 multicall3~~ **有，可用** | 2026-09-20 链上实测：规范地址上有 3,808 字节的 Multicall3。Relay 链配置里那个字段为空不代表链上没有，不需要降级方案。 |
| 9 | **联调只能在主网** | Relay 无 Arc 测试网。建议用小额（1–5 USDC）在主网跑通链路，Arc 侧 gas 成本可忽略（< 0.001 USDC）。 |

---

## 5. 复现命令（本次调研实际执行）

```bash
# Arc 主网链上事实
curl -s -X POST https://rpc.mainnet.arc.io -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# -> {"result":"0x13b2"}   即 5042

curl -s -X POST https://rpc.mainnet.arc.io -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_gasPrice","params":[]}'
# -> {"result":"0x4b6ba30ff"}  ~20.25 Gwei

# Relay 链配置（在返回的 60 条链里查 arc）
curl -s https://api.relay.link/chains | jq '.chains[] | select(.name=="arc")'

# Relay 测试网（确认无 Arc）
curl -s https://api.testnets.relay.link/chains | jq '.chains[].name'
# -> "base-sepolia" "sepolia"

# Base USDC -> Arc 原生 USDC 报价
curl -s -X POST https://api.relay.link/quote -H 'content-type: application/json' -d '{
  "user":"0x1111111111111111111111111111111111111111",
  "recipient":"0x1111111111111111111111111111111111111111",
  "originChainId":8453,"destinationChainId":5042,
  "originCurrency":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "destinationCurrency":"0x0000000000000000000000000000000000000000",
  "amount":"1000000000","tradeType":"EXACT_INPUT"}'

# 容量
curl -s 'https://api.relay.link/config/v2?originChainId=8453&destinationChainId=5042&currency=usdc&user=0x1111111111111111111111111111111111111111'
```

注：`rpc.mainnet.arc.io` 对无 UA 的裸 HTTP 客户端返回 403，用 curl（默认带 UA）正常。

---

## 6. 参考资料

- Arc EVM 差异：https://docs.arc.io/arc/references/evm-differences
- 连接 Arc（RPC / chainId）：https://docs.arc.io/arc/references/connect-to-arc
- USDC 系统事件（索引指南）：https://docs.arc.io/arc/references/usdc-system-events
- 合约地址：https://docs.arc.io/arc/references/contract-addresses
- Gas 与费用：https://docs.arc.io/arc/references/gas-and-fees
- 文档索引：https://docs.arc.io/llms.txt
- Relay 支持链：https://docs.relay.link/resources/supported-chains
- Relay Bridge：https://relay.link/bridge
- Relay Chains API：https://api.relay.link/chains
