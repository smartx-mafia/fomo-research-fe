> **归档文档 —— 原样搬入，未逐句校订。**
>
> 来源：`web-embedded-harness` 仓库的 `README.md`（归档时 HEAD `15670e5`），于 **2026-09-18** 迁入
> `fomo-research-fe/app/docs/harness/`。
>
> 正文**一个字未改**，为的是能与归档仓库逐行对照。代价是：其中关于 **Vite / `vite.config.ts` proxy /
> `import.meta.env.VITE_*` / `npm run dev` / dist 构建与部署**的描述**已不适用于本仓库**。
> 迁移后的现状、以及若干已被实测推翻的说法，一律以同目录的
> [`migration-notes.md`](./migration-notes.md) 为准；迁移方案见
> [`migration-spec.md`](./migration-spec.md)。
>
> ——以下为归档原文——

# embedded 钱包签名 harness

签名发生在浏览器里、用 Privy 用户自己的 embedded 钱包，走 **Fast Swap v2（`/v2/swaps`）**。
它同时是原生客户端接入 v2 的**参考实现**（2026-09-17 起；v1 `/v1/meme/trades` 已从本仓删除，不留开关）。

```
capabilities ─> quote（只看不签）─> POST /v2/swaps（建单，幂等键）─> 可签版本 READY
      ─> 签前核对 ─> 浏览器里只签不发 ─> 签后核对 ─> 产物落盘 ─> executions（幂等键）
      ─> 轮询 events，poll_after_ms === null 才停 ─> 结局 outcome
```

术语（Swap / Intent / Quote / Revision / 签名产物 / Execution / Outcome / 完成）见
[`CONTEXT.md`](./CONTEXT.md)；为什么删 v1、为什么是参考实现，见 `docs/adr/0001-*`。

页面顶部有**两个联调台**（2026-09-03 起，整合自 `../privy-login-demo`）：

- **签名实跑台**：上面那条链，外加后端自检与登录/验收。
- **X 账号绑定**：`/v1/user/x/*` 那四个端点的全流程（发起 → 授权 → 完成 →
  轮询关注导入 → 解绑），两条回调路径都在。

两台**共用同一份身份与同一条流水日志**，切来切去不会把线索弄丢。

## Fast Swap v2（2026-09-17）

契约真值在后端仓：`docs/contracts/fastswap.md`、`docs/contracts/fastswap-app.md`、
`api/fastswap/v1/*.proto`。事实源优先级：**后端 master 代码 > proto > fastswap.md > fastswap-app.md**。

### 代码在哪

| 文件 | 管什么 |
|---|---|
| `src/fastswap/wire.ts` | 线格式：数字枚举、十进制字符串大数、`null` 只出现在 oneof / optional |
| `src/fastswap/client.ts` | HTTP：幂等键、失败信封的 `metadata`（按 `recovery_action` 分支）、裸 403/413、执行上报四个计时点 |
| `src/fastswap/verify.ts` | 签前七条（app 契约 §4）+ Solana 解码核对（message_hash、fee payer、平台预签验签、查找表）+ EVM 复核（EIP-712 摘要、Calibur 域、批次边界、7702 目标）+ 签后核对 |
| `src/fastswap/store.ts` | `localStorage` 存 intent / 幂等键 / 签名产物（按「环境:用户」分桶，终态即清）；`navigator.locks` 签名锁 |
| `src/fastswap/flow.ts` | 一键编排与全部恢复分支；依赖全注入，单测逐条走到 |
| `src/fastswap/SwapPanel.tsx` | 接线：Privy 签名 hook、报价、在途列表、故障注入、时间线 |

EVM 摘要有一份跨语言钉子：后端 `quote/testdata/evm-calibur-typeddata.json` 拷进
`src/fastswap/testdata/`，Go（`apitypes.TypedDataAndHash`）与 viem（`hashTypedData`）
都算出 `0x82f0…7390`，钉在 `verify.test.ts`。

**交给钱包去签的那一份，`types` 要原样带上 `EIP712Domain`。** 服务端的 `domain` 是
protobuf `Struct` 编出来的，**键是字母序**；摘掉 `EIP712Domain` 就等于让钱包自己推域类型，
按键序推出来的 `domainSeparator` 与规范序（name, version, chainId, verifyingContract, salt）
完全不同（`0xd6bd…` vs `0x82f0…`）。症状是签名完全合法、`ecrecover` 出一个钱包列表里
根本没有的地址（2026-09-18 的 `0x9324fb48…`），而三个方向的排查都指不回字段顺序。

### 本轮范围与页面形态

- 页面选「标的在哪条链」+「方向」，由 `shapeOf` 映射成路线：Solana 买入（`side=1`）、
  跨链买入（Solana USDC → EVM 链上的币，`side=1`，目的链是标的那条）、Solana 卖出
  （**`side=3`**，`side=2` 在 Solana 上会被拒）、EVM 卖出回 Solana USDC（`side=2`，走 `evm_calibur`）。
  链集合从 `src/chains.ts` 派生（五条），某条开没开由 capabilities 说了算。
- **出资与收款钱包各按自己那条链挑**：跨链买入的收款侧在标的链上，填 Solana 钱包 id 会被回 400602。
- 只有一键；EXPIRED 自动 `/refresh` 至多一次，再过期就停；「取消」只在已建未签时出现。
- 在途列表：本地有记录的行「恢复」（本地存着签名产物就**只上报它，绝不重签**），
  本地没有记录的行只「跟进」不签。
- 「高级」里五个一次性故障注入：丢建单回包、签完不上报、丢上报回包、等过期、双发。
- **签名默认静默，没有开关**（2026-09-18 起）。弹窗实测会拖过约 39 秒的可签窗口：
  c5922c3e 签完用了 53 秒，服务端验签后没有广播（`expired_unsent`）。
- 「完成」只指 `outcome=COMPLETED`；执行 ACCEPTED、目的链 OBSERVED 都不是完成，
  执行 UNKNOWN 不是失败。持仓（`/v1/portfolio`）只作旁证，不再用来判结果。

### 本机要起的后端

v2 **不在 business 上**，是独立进程 `sx_fastswap`（`:8082`）+ `sx_fastswap_worker`。
没有 worker，swap 会停在「已上报」，永远到不了完成。

```bash
# 后端仓根目录
make sx_fastswap sx_fastswap_worker
./bin/sx_fastswap        -conf ./configs/local/fastswap.yaml
./bin/sx_fastswap_worker -conf ./configs/local/fastswap.yaml
```

- `configs/local/fastswap.yaml` 由 `configs/fastswap.example.yaml` 派生，凭据在同目录
  `fastswap.secret.yaml`（`conf.Load` 自动叠加）；库与 `sx_trade` 同一个（要有 `app.wallet_locks`）。
- business 要开内部 gRPC `server.grpc: 127.0.0.1:18000`：fastswap 经它的
  `Directory.ListUserWallets` 核对钱包归属，没开的话每次建单 `500097`。
- Solana 两条路线要代付账户**有 SOL**（它付手续费与租金）；Relay app balance 可能也要有余额。
- 浏览器经 vite 代理 `/v2/swaps` 进来，代理**摘掉 `Origin` 头** —— fastswap 的
  `allowed_origins` 零值是拒绝一切带 Origin 的请求，回的是不套信封的裸 403。
- 服务端 `quote.max_slippage_bps` 本机是 300，页面默认也是 300；超限拒单不截断。
- 测试环境那一档（`/test-env`）本轮**没接** v2。
- 本机 `curl localhost` 要加 `--noproxy '*'`，否则系统代理会回 502。

### 钱包 id

v2 请求里带的是 **Privy 钱包 id**（`source_wallet_id` / `destination_wallet_id`），
服务端据此推导地址并核对归属；后端没有对外返回它的接口，页面从
`user.linkedAccounts[].id` 取。取不到时按钮灰着并写明原因。

## 它与 Go 那条 harness 分别证明什么

仓库里已经有一条端到端实跑：`app/trade/internal/meme/sponsor/privy_live_trade_test.go`。
两条路**不是重复**，各自覆盖的东西不同。

> 这张表写于 v1 时代，Go harness 那一列仍是旧链路。v2 里「钱包归属」一行对应的是
> `sx_fastswap` 经 business 内部 gRPC 调 `Directory.ListUserWallets`，这个页面**每次建单都走**。

| | Go harness | 这个页面 |
|---|---|---|
| 签名者 | server wallet（owner 是我们自己那把 P-256 钥匙） | **embedded wallet**（用户持有，服务端签不动） |
| 走不走 business 的对外 HTTP 面 | 不走，直接调 trade 的 Service | **走**，与真前端同一条路 |
| `resolveWallets`（business → Privy 查钱包归属） | **一次都碰不到**（自己构造 kernel.Wallet） | **每次下单都走** |
| 恒 200 信封、六位码、Bearer 验签 | 绕过 | 全部经过 |
| 能不能无人值守跑 | 能 | 不能，要人点 |

对外 HTTP 那一层本身**已经有一条端到端验收**：
`app/business/internal/server/e2e_meme_trade_test.go`（真 JWT、真中间件链、
真信封、真 Privy 客户端，只有 Privy 的对端是桩）。所以这个页面**不是**
"第一次打通 HTTP 面"，它独有的是最后两格：**真的 Privy** 与**真的浏览器签名**。

"服务端签不动 embedded 钱包"是实测结论，不是猜的：
`app/business/internal/privysecurity/privy_smoke_test.go` 拿 app 凭据对一个 embedded
钱包调 `signTransaction`，Privy 回 401。所以 embedded 那一半**绕不过一个真
浏览器** —— 这个页面就是那个浏览器。

## 跑之前要有什么

**1. 后端起着。** business（`:8080`，且开着内部 gRPC `:18000`）、`sx_fastswap`（`:8082`）
与 `sx_fastswap_worker`，见上面「本机要起的后端」。business 的 `privy.app_id` /
`app_secret` 必须配在 `configs/business.secret.yaml` 里，否则登录与钱包归属都会 `500097`。

**2. Privy dashboard 配好了。**

- Authentication → JWT-based auth：传的是 **X.509 证书**（`keys/jwt_rs256.cert.pem`），
  不是裸公钥；User ID claim 填 `identifier`（本仓的 JWT 没有 `sub`）
- 使用场景 `Client side` 与 `Server side` 是多选，**两个都要开** ——
  embedded 签名发生在浏览器里，关掉 Client side 这条路直接不通
- Solana 的 embedded wallet 要启用

**3. 前端配置。**

```bash
cd web/embedded-harness
cp .env.example .env.local     # VITE_PRIVY_APP_ID + VITE_SOLANA_RPC_URL，两个都必填
npm install
npm run dev                    # http://localhost:5173
```

`VITE_SOLANA_RPC_URL` 不是可选项：Privy 的签名弹窗自己要一个 Solana RPC
客户端来模拟交易、估手续费。不给的话点"签名"时它在组件内部抛
`No RPC configuration found for chain solana:mainnet`，**整个页面白屏** ——
而白屏长得像"页面没加载出来"，没人会往"少配了一个 RPC"上想。
现在两个缺一个都会在启动时说清楚，且页面外包了一层 error boundary，
再有异常也只会显示出来，不会把过程日志一起吞掉。

**4. 一个收得到验证码的邮箱。**（2026-09-02 起）

> **第一个该点的按钮不是登录，是卡片 0 的「运行自检」**（2026-09-03 起）。
> 它不碰 Privy，只回答「后端够不够得着、是不是带登录的那个构建」。
> 没有这一步的话，代理没起、后端是旧构建、identity token 过期这三件事的
> 症状都是「登录失败」，而排查方向完全不同。两个探针都绿了再往下走。

身份卡里填邮箱 → 收验证码 → 填 6 位码，剩下的自动走完：

```
Privy 邮箱验证码登录 → identity token → POST /v1/auth/login → 本站 JWT + identifier
```

> **这里从前还有第四步 `linkWithCustomJwt`，2026-09-03 删了。** 后端已改成按
> `privy_did` 查钱包，那一步整个不需要；而它还要求 Privy 开着 JWT-based auth
> （两个 app 都没开），于是当场 401、把下单按钮永久锁死。见文末那一节。

Google / Apple 那两条路是同一条链，只有第一格换成整页跳转的 OAuth。
它们**默认点不亮**：要 Privy 控制台开了 `google_oauth` / `apple_oauth`，
`.env.local` 里的 `VITE_ENABLE_GOOGLE` / `VITE_ENABLE_APPLE` 也置成 true ——
两道闸都合上才行。页面会把是哪一道没开写在按钮旁边。

`identifier` 由回包给出，**页面上只读**。它是 business 的 `subjectIdentifier`
交出来的那个串，也是它在 `app.users` 里换到 `privy_did` 的键 —— 对不上的症状是
"钱包查不到"或"仓位是空的"，而没有一处会报错。卡片 1 的「验收：GET /v1/user/info」
就是为了当场把这件事比一遍。

business 查钱包走的是 **`GET /users/<privy_did>`**：登录时它验过 Privy identity
token，把 `(identifier, privy_did)` 原子落进 `app.users`，之后按 identifier 读这条
**本地已验签的映射**再用 DID 去问 Privy。所以前端除了登录之外**不需要再对 Privy
做任何事**（`privysecurity/client.go` 的注释：「这里不能再要求
`custom_user_id = identifier`」）。

> **这台 business 必须配好 `privy.app_id` 与 `privy.verification_key`**，
> 否则 `/v1/auth/login` 回 500097，页面从第 0 步就断。**没有本机逃生舱了** ——
> `/dev/token` 与手填 identifier 已于同日删除，理由见文末那一节。

> **每次登录都会新换一个 token，且它不进 localStorage。** Privy 会话靠 refresh
> token 撑 30 天，而本站 JWT 只有 72 小时；存着必然出现「已认证但每个请求 401」，
> 而那正是从前专门做一个「token 已过期」徽章去解释的东西。现在刷新页面会自动重换。

**5. 钱。** 第一次登录时 Privy 会给这个用户建一个全新的 embedded 钱包，
它是空的。页面上会显示地址，**往它打 USDC**（以及别忘了这条链上的
交易由代付账户付 gas，用户钱包不需要 SOL）。

> 转账不在这个 harness 的职责里，也不该在。钱从哪个钱包出去是人的决定。

## 一个已经踩过的坑：不要开 StrictMode

React 的 StrictMode 在开发模式下故意把 effect 跑两遍，用来暴露不幂等的
副作用。而建 embedded 钱包正好是一个不幂等的副作用 —— 跑两遍就**建两只
钱包**（2026-08-28 实测，当时还走 `createOnLogin`：两只 EVM 钱包的
`first_verified_at` 相差 1 秒）。

现在建钱包改成了显式按钮（headless 登录不触发 `createOnLogin`，见上），
但这条不因此作废：按钮之外，登录后那串 effect 里任何一步碰到建钱包，
症状都一样。

**代价是永久的**：Privy 的钱包删不掉。服务端按 `wallet_index` 最小挑一只,
另一只从此躺在账户里，每次列出来都要解释一遍。

顺带一提：v1 时代这个事故催生了「签名地址由服务端点名」。v2 里请求带的是
Privy 钱包 id，revision 里写明签名者地址，签前核对第 1 条逐笔比对它与本页钱包。

## CORS

`vite.config.ts` 把 `/v1` 同源代理到 business。**这是为了绕开 CORS，不是为了
方便** —— 本仓的已知缺口表里 CORS 一栏写着「无」，浏览器跨源打 business
会在预检就被拦下，而 `fetch` 抛出来的 `Failed to fetch` 与"后端没起来"长得
一模一样。

真前端上线时这条路不存在：要么网关把前端与 API 摆在同一个源下，要么
business 真的补 CORS。那是缺口表里的活。

## 顶栏的「环境」开关：本机 / 测试环境（2026-09-09）

顶栏最左边、标题旁边有一个两档开关。它决定这一整页对着**哪一个 business** 跑。

**为什么需要它。** 本机与测试环境各有一套后端与 Privy app。**v2 目前只接了本机档**；
测试环境那一档的 `/v1`（登录、持仓、X 绑定）照常可用，Swap 卡在那一档会报 capabilities 失败。

**一个环境不止一个变量，这是它是开关而不是一行配置的原因。** 换后端的同时
必须换 Privy app id：business 拿自己的 `privy.app_id` 当 identity token 的
`aud` 校验值，前端 SDK 用的 appId 与它不一致时登录**一律 400100** —— 而那个
码指向 identity token，看起来像 Privy 出了问题。手工改 `.env.local` 再重启
也能换，但那条路上漏改一个不报错。

**两个环境是两套用户、两套钱包。** 两个 Privy app 各有各的用户表，同一个邮箱
在两边是两个人，embedded 钱包地址不同。所以切换必然要重新登录一次。

### 形状

| | |
|---|---|
| 选择存在哪 | `localStorage` 的 `harness.env`，值是 `local` / `test` |
| 怎么落地 | `location.reload()` 整页刷新 —— appId 是 `PrivyProvider` 的 prop、本站 JWT 只活在内存里、页面上读过的状态全属于上一个环境，一次刷新把三件事一起清掉 |
| 请求怎么分流 | 选中测试环境时，每一发请求路径前面多一段 `/test-env`（前缀只在 `src/api.ts` 的 `call` 一处加），`vite.config.ts` 里那条代理按它转到 `TEST_BUSINESS_ORIGIN` 并把前缀摘掉 |
| 代码 | `src/envs.ts`（环境表 + 选择 + 切换）、`src/envs.test.ts` |

**为什么是路径前缀而不是"改 target 重启"**：两档同时在线，页面上选，就不会
只切一半。顺带的好处是 devtools 的网络面板里一眼看得出这一发打的是哪个环境。

**为什么不让页面直接打绝对 URL**：business 不发 CORS 头（上一节），跨源打它
预检就被拦下。两档都得经同源代理。

### 配置与两个失败形态

`.env.local` 里这几行（说明见 `.env.example`）：

```
VITE_TEST_PRIVY_APP_ID=cmtb1g7g800l10dkzdlqi80zm   # 这一档的总开关，取自测试机 business.yaml 的 privy.app_id
TEST_BUSINESS_ORIGIN=https://sm-test-api.smartx.io  # 没有 VITE_ 前缀 = 只给 dev server 看
VITE_TEST_BUSINESS_ORIGIN_LABEL=https://sm-test-api.smartx.io
```

- **没配 `VITE_TEST_PRIVY_APP_ID`**：那一档在顶栏上**禁用**，title 里写着缺
  哪个变量 —— 不隐藏，因为消失了的开关与"这个版本没这功能"分不开。
- **存着的那一档后来配没了**：退回默认档，并在顶栏上挂一枚红芯片说明。
  静默退回的表现是"我明明选了测试环境，可单还是进了本机"，而开关显示的确实
  是本机，两条信息不矛盾，于是没人会去怀疑它。

**改了 `.env.local` 或 `vite.config.ts` 要重启 dev server**（vite 只在启动时
读一次 env）—— 不重启的症状是切过去之后请求 404，看起来像后端没这条路由。

### 部署在 smartx-test 上的那一份不要配这一档

那台机器上页面与 API 同源，`/v1` 直接落到本机 business（也就是测试环境的
business），根本不经这个代理；而 `/test-env/v1` 会被 nginx 的 `/` 吃掉、回
404。所以那边只配 `VITE_ENV_LABEL`，把默认档的名字改成实话：

```
VITE_ENV_LABEL=测试环境（同源）
```

（默认档的名字可配就是为了这个：那儿显示「本机」是假的。）

## 部署在 smartx-test 上（2026-08-31，2026-09-07 重建）

**https://sm-test-api.smartx.io/harness/** —— basic auth，用户名 `smartx`。

> **域名换过一次。** 从前是 `be-test-api.smartx.io`，2026-09-03 起
> `/etc/nginx/conf.d/smartx.conf` 里的 `server_name` 改成了 `sm-test-api.smartx.io`。
> 两个名字都解析到 Cloudflare，但只有 `sm-` 那个在这台 nginx 上有 server 块，
> 另一个落到默认站点 —— 症状是「页面还在，只是变成了 nginx 欢迎页」，
> 看起来像部署没生效。公网 IP 同时从 `13.231.246.26` 变成了 `35.78.100.24`。
跑的是 `vite dev` 而不是静态产物（历史原因：从前 `/dev/token` 只存在于开发
服务器里。那条路已删，现在跑静态产物也可以）。

### 为什么必须是 HTTPS，而且必须挂在这个域名下

**Privy 的 embedded 钱包在非安全上下文里直接抛异常**：

```
s3: Embedded wallet is only available over HTTPS
```

它抛在渲染期，React 整棵树跟着挂掉 —— 页面**白屏**，控制台只有这一行。
`localhost` 算安全上下文（所以本机开发一直正常），`http://<IP>` 不算，
**换哪个端口都一样**。这一条把「自己开个端口跑」整条路堵死了。

`sm-test-api.smartx.io` 在 Cloudflare 后面，边缘已经有 HTTPS，所以挂到它下面的
一个路径最省事 —— 不用申请证书、不用加 DNS、不用开安全组端口（只有 22/80/8080
是开的，那台机器的 12123 之类一律不通）。

代价与形状：

- `VITE_BASE_PATH=/harness/` → vite 的 `base`，**只影响静态资源前缀**。
- 页面里 `/v1` 是绝对路径，于是**同源**落到同一个域名下的 business —— 真前端
  上线时本来就该是这个形状，连 CORS 与代理都不存在（`BUSINESS_ORIGIN` 那条
  代理在这个部署里根本用不上）。
- ~~`/dev/token`~~ 已删除（2026-09-02）。那个 location 可以从 nginx 里摘掉了 ——
  它从前签出来的 token **能下真单、自己没有任何认证**，是这台机器上最该关掉的口。
- `VITE_ALLOWED_HOSTS` 要包含 `sm-test-api.smartx.io`，否则 vite 回 403
  "Blocked request"，而那看起来像 nginx 配错了。

| | |
|---|---|
| 代码 | `/home/ubuntu/smartx/web-embedded-harness` |
| 服务 | `systemctl {status,restart} meme-harness`（监听 127.0.0.1:5173） |
| 反代 | `/etc/nginx/conf.d/smartx.conf` 里的 `/harness/` location（`/dev/token` 那个已废弃，可删）（`harness.conf` 里另有一份按 IP / 12123 的入口，HTTP 下 Privy 用不了，留着只为调试非 Privy 的部分） |
| 口令 | `/etc/nginx/.htpasswd-harness` |
| 更新 | `rsync` 上去即可，vite dev 自己热更新；改了 `vite.config.ts` 或 `.env.local` 才要 restart |
| node | 机器上**没有系统 node**，用的是解包在 `~/.local/node22` 的官方 v22 二进制（`/usr/local/bin/{node,npm,npx}` 是指向它的软链）。重装机器要先补这一步，否则 `npm ci` 连命令都找不到 |
| 单元 | `/etc/systemd/system/meme-harness.service`（2026-09-07 重建；`ExecStart` 写的是 `~/.local/node22/bin/npm`，不是 `npm` —— systemd 的 PATH 里没有它） |

几处不显然的：

- **按路径挂，不占 `/`。** 那个 server_name 下 `/` 是 business 的 API，
  harness 挂上去会把它整个遮掉。`/harness/` 是最长前缀匹配，优先于 `/`，
  API 不受影响（改完实测过）。
- **走过的弯路**：先按机器 IP 在 :80 上开 server 块（curl 通、浏览器却落到
  nginx 默认欢迎页 —— 浏览器发的 Host 与写死的那个对不上，而这种错不报错，
  看起来像"部署没生效"），再换独占 12123（安全组没放行）。两条路最后都倒在
  同一件事上：**HTTP 下 Privy 根本起不来**。
- **basic auth 不是装饰。** 这个页面花的是真钱，而登录之后它能下真单、能把
  钱包里的币转走。dev server 因此也只监听 127.0.0.1，不 `--host 0.0.0.0`。
  （`/dev/token` 那个「无认证却能签出可下真单的 token」的口已经不存在了，
  但 basic auth 的理由并没有随之消失。）
- **`VITE_*` 的值会进 bundle**，也就是任何登进来的人都读得到 Alchemy /
  QuickNode 的 key。basic auth 挡的是扫描器和误点，不是有心人。
- **`VITE_ALLOWED_HOSTS`**：Vite 默认只认 localhost 那几个 Host（防 DNS
  rebinding），放在反代后面必须把机器地址列进去，否则每个请求都被回一句
  "Blocked request"，而那看起来像 nginx 配错了。

### Solana 的两套 SDK 是**并存**的，谁都不删

`@solana/kit` 与 `@solana/web3.js` 同时在依赖里，这不是迁移没做完的中间态，
是**分工**：

| 包 | 谁在用 | 管什么 |
|---|---|---|
| `@solana/web3.js` | `src/fastswap/verify.ts`、`src/transfer.ts` | **解码交易、核对签名** —— 所有与交易语义有关的代码 |
| `@solana/kit` | `src/main.tsx` 一处 | 喂给 Privy 的 `config.solana.rpcs` 配置对象 |
| `@solana-program/{memo,system,token}` | Privy 的 `solana.mjs` | 它的 optional peer dependency，见下 |

**web3.js 那一半是照着 App 端选的**：App 只有 `@solana/web3.js@1.98.x`，
两端抄同一份实现才不会出现"其中一份没有守卫"。

**kit 那一半删不掉**：Privy 的 web SDK 把 `config.solana.rpcs` 的类型钉死在
kit 的 `Rpc` 上（SDK 类型注释原话："@solana/kit RPC configuration objects"），
web3.js 的 `Connection` 塞不进去。它与交易语义无关，**App 端根本没有这一处**
（Expo SDK 不提供签名界面，也就不需要 RPC 去模拟交易）—— 所以它不是前端要
抄的东西，但也不是可以顺手清理掉的东西。

**看到"这里怎么有两套 Solana SDK"时，正确的动作是读上面这张表，不是收敛掉
一套。** 收敛的代价分别是：动 web3.js → App 端没法抄；动 kit → Privy 的
签名路径起不来。

### 别删 `@solana-program/{memo,system,token}`

`src/` 里一次都没 import 它们，看起来是三个没人用的依赖 —— **但它们是
`@privy-io/react-auth` 的 optional peer dependency**，消费者是 Privy 的
`solana.mjs`，不是我们的代码。删掉之后 `npm test` 与 `npx tsc --noEmit`
**照样全绿**，只有 `npm run build` 会失败：

```
"getAddMemoInstruction" is not exported by
"__vite-optional-peer-dep:@solana-program/memo:@privy-io/react-auth:false"
```

判据是"谁在 import 它"，而不是"我们的 src 里有没有它"。
2026-08-28 按后者判过一次，当场把构建删坏了。

## 交易后自动重查 USDC 余额

Solana 钱包那一行的地址后面挂着一格 `USDC <数字>`（`src/balance.ts` +
`App.tsx` 里的 `useUsdcBalance`）。**它没有刷新按钮，也不该有。**

理由是"这一笔到底从我账上扣了多少"在 Swap 卡之外没有别处摆出来。
把重查做成一个按钮，等于恰恰在最该看一眼的那一刻依赖人的记性。

- **触发**：一笔 swap 轮询到终态（`poll_after_ms === null`）时重查一轮，同时重查一次持仓。
  两者都只是旁证，判定一笔成没成只看 `outcome`。
- **一轮 = 4 次**（0/3/8/15 秒）。Submit 返回的那一刻交易刚广播出去，
  即使用 `confirmed` 这一档，链上余额也常常还没跟上，只查一次会稳定读到
  "还没扣" —— 而那长得和"这笔没成功"一模一样。
- **直接打 `VITE_SOLANA_RPC_URL`**，不经过 business（对外面上没有查余额的
  端点），也不需要代理：那个端点本来就被浏览器直接打（Privy 的签名路径在用）。
- **按 `owner + mint` 问 `getTokenAccountsByOwner` 并把命中账户全加起来**，
  不自己推 ATA：一个 owner 名下不止一个 USDC account 是常态（实测过），
  只读 ATA 会显示成"比实际少"。
- **读不到就说读不到**，不留上一次的值：429（限流）与 401（RPC key）的处置
  完全不同，所以错误原文直接摆在余额那一格旁边。

守卫在 `src/balance.test.ts`：换算（尾零、前导零、超出 2^53）、多账户求和、
一个 token account 都没有、请求参数（mint 过滤 + `confirmed`）、HTTP 错误、
JSON-RPC 错误。

## 转出：把币从 embedded 钱包转走（2026-09-02）

在第 1 张卡「交易」里，与「下单」**同卡分 tab**（原本是独立的第 4 张卡）。
两者是同一只钱包上的两种动作，分成两张卡的时候，人要在页面上跳着看同一个
地址的两件事；而它们又互斥（同一时刻只做一件），所以是 tab 不是并排。
tab 用 `hidden` 藏而不是条件渲染 —— 后者会把没显示那一侧卸载掉，切走再切回来
填了一半的金额和核对过的地址全没了。

它它回答一个这个页面原本回答不了的问题：**跑完实跑，钱怎么拿出来。**

在它之前，这个页面只会买和卖 —— 钱进得来、币换得动，但出不去。business 的对外面上
确实有提现（`/v1/withdrawals/chain/prepare|submit`），可那条契约自己写着「生产网络
默认全部关闭」，而且是一条完整的 prepare/submit 流程，harness 一行都没实现。于是每次
跑完，钱就留在那只 embedded 钱包里 —— 而换一个身份就再也够不着了（旧钱包私钥是裸 hex、
没有 BIP39 助记词，Privy 的导入只认助记词，见 ADR-0010「代价一」）。

### 三条取舍，写下来免得被当成疏漏

**一、广播交给 Privy，不是我们自己发。** 用的是 `useSignAndSendTransaction`
（`@privy-io/react-auth/solana`），我们只组包。少写的那部分恰好是最容易写错的：
blockhash 过期后的重试、commitment 等级、以及「发出去了但确认超时」与「根本没发出去」
怎么区分 —— 写错不会报错，只会让人以为是签名坏了。

**这不违反 ADR-0010 决定二**（「广播必须由服务端做」）。那条守的是 meme 交易的账本
不变式：一笔查不到的链上交易是 ADR-0009 的反例。而这笔转账不进 `trades`、不产生分录、
服务端从头到尾不知情 —— 它对账本的影响和用户自己在钱包 App 里转一笔完全相同。
**连带后果**：持仓那张表不会因为这笔转账而变化，因为它记的是买卖，不是链上余额。

**二、只支持经典 SPL Token，Token-2022 显式拒绝。** 不是"暂不支持"的托词：Token-2022
的 transfer hook 与手续费扩展会改变转账语义，拿经典 program 的指令去组包，链上回的是
一句不指向这里的错误。「核对」那一步会读 mint 的 owner program 并当场拒掉。

**三、不转 SOL，也不关 ATA 回收 rent。** 转 SOL 要处理"留多少手续费"——留少了下一笔
发不出去、留多了没清干净，那是个需要试错的数字，不该出现在第一版；关 ATA 能收回约
0.002 SOL，收益不够它自己的复杂度。**手续费由这只钱包自己付，所以它必须有 SOL**，
一个 SOL 为 0 的钱包在这里点下去会失败在广播那一刻。

### 转错地址这件事，页面上到底靠什么挡

**离线校验挡不住「粘贴少一位」，这一点必须说破。** 44 个 base58 字符去掉一个，解出来
**仍然可能是 32 字节**（43 个字符最大约 2^251.8，照样落在区间里）。所以 `isSolanaAddress`
的「长度对」不等于「地址是你想的那个」，而这不是可以修的 —— 任意 32 字节都是一个语法
合法的 Solana 地址，离线无从判断收款人是谁。用例钉在 `transfer.test.ts` 的
「**挡不住「粘贴少一位」**」那条，它记录的是缺口，不是能力。

真正管用的是两道：

1. **地址全文显示，不截断。** 截断是转错地址最常见的来路 —— 中间那几十个字符正好是
   肉眼最不会去比对的部分。
2. **「核对」查链上形态**：目标账户存不存在、是不是普通钱包、有没有这个币的账户。
   手滑出来的地址几乎必然**查无此账户**，而那一行在页面上是加粗的。
   地址或 mint 一改，上次核对的结论立刻作废 —— 留着它等于拿 A 地址的「存在」给 B 背书。

金额那一侧只有一道：`parseUnits` 在小数位超过 `decimals` 时**报错而不是截断**。截断是
这段代码唯一会**少转钱**的错法，而它不报错 —— 页面正常、链上成功，只是到账比输入的少。

### 代码在哪

- `src/transfer.ts` —— 纯函数（`parseUnits` / `decodeBase58` / `encodeBase58` /
  `isSolanaAddress` / `checkDestination`）+ 三个 I/O（`fetchMintInfo` / `fetchDestInfo` /
  `buildSplTransfer`）。
- `src/transfer.test.ts` —— 26 个用例，守的是**转错钱**，不是"函数写得对不对"。
- `src/App.tsx` 第 4 张卡 —— 只做胶水。

**组包别照抄官方 starter 的最后一行。** `privy-io/examples` 里那份写的是
`Buffer.from(wire, 'base64')`，它靠自己 vite 配置里的 `nodePolyfills()` 才跑得起来；
我们没有那个插件，照抄过来是运行期的 `Buffer is not defined`，而 typecheck 一声不吭
（`@types/node` 让它编译通过）。这里用的是仓里已有的 `fromBase64`。其余可复用性的
调研结论在 `privy-examples-survey.md`。

## 登录改走真实链路：邮箱验证码 + custom_auth link（2026-09-02）

> **追记（2026-09-03）：下面那个 ④ `linkWithCustomJwt` 已经删了，连同
> `identity.ts` 的 `needsCustomAuthLink` 与 `readiness()` 里那一格。**
> 本节其余部分（①②③、headless 的理由、就绪判据补两项）仍然成立。
> 为什么删、以及那个前提当初就不太对，见文末「custom_auth link 是多余的」。

从前这个页面**没有登录框**：手填一个 `identifier`，`/dev/token` 签一个 business
形态的 JWT，而那个 token 有两个消费者 —— business 的 Bearer，与 Privy 的
custom auth（`useSubscribeToJwtAuthWithFlag` 盯着它，一有值就把用户顶上去）。

**那条链生产上不存在。** 真实前端走的是 Privy 原生登录换本站 JWT。一个验不到
真实身份链路的 harness，验到的东西对生产不成立 —— 所以整条换掉。

### 四步，任一步没过都不算登录成功

```
① useLoginWithEmail()         headless 的邮箱 OTP，自己做 UI，不走 Privy modal
② useIdentityToken()          拿 identity token
③ POST /v1/auth/login         {AUTH_CHANNEL_PRIVY, AUTH_METHOD_EMAIL, identity_token}
④ linkWithCustomJwt(本站 JWT)  把 custom_auth 挂到同一个 Privy DID 上
```

**钱包不在这四步里，要自己建。** Privy 的自动建钱包（`createOnLogin`）**只对走
Privy modal 的登录生效**，官方文档明写 whitelabel / headless 的登录接口不支持
（"Automatic wallet creation only applies to login via the Privy modal and not from
whitelabel login methods."）。而 ① 正是 headless 的。所以 `main.tsx` 里那两行
`createOnLogin` 与 Privy Dashboard 上的三个开关都是死的 —— 2026-09-03 对照过两个
app 的线上配置（本机是 `off`，smartx-test 是 `users-without-wallets`），**表现完全
一样**：都得点页面上的「创建 embedded 钱包」。

**顺序不能反。** 两只 embedded 钱包建在 ① 之后的这个 DID 上；④ 只是往同一个 DID
上再挂一条 linked account，所以服务端后来用 `custom_auth/id` 查到的，就是前端会话
里那批钱包。

**③ 不带 `Authorization` 头。** 契约明写：登录端点对无头请求放行，但带了坏/过期
token 一律 400000、绝不降级成匿名。而登录恰恰是"手上那个 token 已经不能用了"的
时刻 —— 顺手带上它会让重新登录这条自救路本身失败，而错误码说的是"未认证"，
指的却是你正要换掉的那个 token。

### ① 为什么是 headless，不用 Privy 的 modal

照 `../privy-login-demo/src/components/EmailOtpCard.tsx` —— 那条已经联调跑通，
形状直接搬过来（`useLoginWithEmail` 的 `sendCode` / `loginWithCode`，状态完全由
SDK 的 `OtpFlowState` 驱动，**不自己维护第二份**：两份状态一定会有对不上的时候，
而对不上的表现是按钮该亮时不亮）。

选 headless 而不是 modal 的理由与 OAuth 那边相反：**邮箱 OTP 没有重定向**，
headless 只是两个输入框加两次调用，而它换来的是每一步都能进这个页面的过程日志。
走 modal 的话，"验证码发出去没有"、"是第几次试"全发生在一个我们看不见的组件里 ——
而这个 harness 存在的意义就是把每一步摊开。

> 同一个验证码 Privy 最多让试 **5 次**，超了必须重发（demo 的 UI 上写着这一条）。

### ④ 为什么先查再决定调不调

「已经 link 过的用户再调一次 `linkWithCustomJwt` 会怎样」—— **官方文档没写**，
`privy-io/examples` 全仓也搜不到一行（见 `privy-examples-survey.md`）。那是一格
未定义行为；而我们对 link 失败的处置是**硬停**。两者相乘等于：老用户第二次登录
就永久进不去。

所以 `needsCustomAuthLink()` 先看 `user.linkedAccounts` 里有没有 `custom_auth`：

| 判定 | 含义 | 动作 |
|---|---|---|
| `ok` | 已挂着，且 `customUserId` 对得上 | 跳过 link |
| `link` | 没有 `custom_auth` | 调一次，失败硬停 |
| `mismatch` | 挂着**别人的** identifier | **硬停** |

`mismatch` 那一格必须单独存在：压成 `link` 会撞上「每类账号每用户最多挂一个」而
失败，且失败文案不会说是因为挂着别人的；压成 `ok` 更糟 —— 服务端会拿这次登录的
identifier 去查钱包，查到的是**另一个人的钱包**，而页面照样能签、能下单。

> `customUserId` 是 **camelCase**。snake_case 的 `custom_user_id` 只属于 REST 回包
> 与 Expo SDK（`privy-io/examples` 的两个 Expo starter 正是那么读的，**别照抄**）。
> 拼错不会有编译错误，只会让这个字段恒为 undefined —— 于是每次登录都判成"缺
> custom_auth"，然后每次都去 link 一个已经存在的账号。

### 下单按钮的就绪判据补了两项

从前是 `ready && authenticated && 有钱包`。现在是五项，且**说得出卡在哪一步**：

```
Privy 已认证 && 有本站 token && custom_auth 已挂且匹配 && 目标链钱包已建好
```

少「有 token」的后果是点下去回 401；少「custom_auth 已挂」严重得多 —— 页面上
一切正常，下单时 business 回 `500000`「暂时无法确认你的钱包，请稍后再试」，
而真因是 Privy 上查不到这个 `custom_user_id`。**它不是 `500097`** —— 那个码
只属于「这台 business 没配 Privy」，两者在服务端是 `ownedWallets` 里的两条分支。判定搬进 `src/identity.ts` 是为了**能测**：`mismatch` 那一格写在
React 里就永远不会有用例，而它是这条链上唯一一道防「动别人的钱」的闸。

### 一并删掉的

`/dev/token` 中间件、`BACKEND_ROOT` / `DEVTOKEN_BIN` 两个变量、identifier 输入框、
`meme-harness.token` 与 `meme-harness.user` 两个 localStorage 键、以及那个
「token 已过期」徽章连同它背后的 `jwtExpiry()`。

**留着比删掉坏**：一个没有消费者的配置项会骗人 —— 下一个人配了 `BACKEND_ROOT`
然后发现它没有任何效果，而配置文件上看不出异常。后端仓的 `scripts/devtoken`
**没有删**，别处还在用。

## 整合 `privy-login-demo` 的全部流程（2026-09-03）

`../privy-login-demo`（smartx-login-fe）是**用户域登录**的联调前端：它验的是
`Privy 登录 → identity token → POST /v1/auth/login → 本站 JWT → GET /v1/user/info`，
外加一整条 X（Twitter）账号绑定链路。这个 harness 从前只用了它的一半
（邮箱 OTP 那条，2026-09-02 那次改动），另一半留在那边。

现在**全部搬过来了**，用本仓的设计系统（`src/ui.tsx`）重写，共用同一条流水
日志与同一份身份 —— 两个联调台切来切去不会把线索弄丢，也不用在 X 那边再登
一次。

### 搬了什么

| 流程 | 来处 | 落在本仓的哪儿 |
|---|---|---|
| 后端自检（两个探针） | `SelfCheckCard` | `src/selfcheck.ts` + 卡片 0 |
| 邮箱验证码登录 | `EmailOtpCard` | 卡片 1（2026-09-02 已有） |
| Google / Apple 登录 | `OAuthCard` + `useOAuthAvail` | `src/oauth.ts` + 卡片 1 |
| 换本站 token（auth_method 可选） | `App.tsx` 的 `exchange()` | `api.ts` 的 `login()` + 卡片 1 |
| `GET /v1/user/info` 验收 | `SessionCard` | `api.ts` 的 `getUserInfo()` + 卡片 1 |
| 六位码表 | `api/codes.ts` | `src/codes.ts` |
| 三类失败 + 报障面板 | `api/envelope.ts` + `ErrorPanel` | `api.ts` 的 `ApiError` + `src/errors.tsx` |
| `x-request-id` | `lib/trace.ts` | `src/trace.ts` |
| JWT 本地解码（看 exp） | `lib/jwt.ts` | `src/jwt.ts` |
| X 绑定四端点 + 两条回调路 + 轮询 | `api/ximport.ts`、`useXBind`、`XBindPage`、两张卡 | `src/ximport.ts`、`src/xcallback.ts`、`src/xpending.ts`、`src/useXBind.ts`、`src/XBindPage.tsx` |

### 刻意**没有**搬的一件事：`session/storage.ts`

demo 把本站 JWT 存 localStorage。**这里不存，而且这是个决定不是疏漏。**

理由已经写在 `App.tsx` 顶部 `token` 那段：Privy 会话靠 refresh token 撑 30 天，
本站 JWT 只有 72 小时 —— 存着必然出现「Privy 已认证但每个 `/v1` 请求回 400000」，
而那正是从前专门做一个「token 已过期」徽章去解释的东西。刷新页面会自动重换
一次，那是一次幂等的 `/v1/auth/login`。

唯一的例外是 `src/xpending.ts`，而它碰的是 **sessionStorage**：X 绑定第 ② 步是
**整页跳转**去 x.com，React 树整个被卸载，内存里那个一次性的 `state` 到时候就
没了 —— 而没有 state 完成不了绑定。选 sessionStorage 不选 localStorage 的理由
写在那个文件头上：一次性的 state 跨浏览器重启活下来的话，下次打开页面时页面会
把一个早已作废的 state 当成"有一次绑定正在进行中"。

### 三处**必须一起改**的地方

搬 OAuth 那条路时踩到的都是"改一处不报错、只是静默说谎"的接缝：

1. **`main.tsx` 的 `loginMethods`** 从 `['email']` 放开到 `['email','google','apple']`，
   与 **`api.ts` 的 `login()` 把 `auth_method` 从写死常量改成参数**是同一件事。
   契约要求 `auth_method` 与 identity token 里真实存在的绑定一致，不一致回
   `100107`。只放开登录方式而漏改那边的症状是"用另一种方式登录的人一律登不
   进去"，而错误码说的是"登录方式不支持" —— 看起来像后端没开。
2. **换取 token 那一步只能读 `authMethodRef`，不能读 `authMethod` state。**
   自动换取跑在一个由 `authenticated` 翻成 true 触发的 effect 里，而那一次
   渲染里 state 有没有更新过取决于 Privy 的 `onComplete` 与它自己的状态更新
   落在哪一批渲染里，**没有保证**。
3. **`useLoginWithOAuth` 的接线必须常驻**，不能挂在"未登录时才渲染"的那段里。
   OAuth 是整页跳转：从 Google 跳回来那一刻 React 树是全新挂载的，收尾由这个
   hook 做 —— 它没挂载的话，登录"没有完成"，而地址栏里明明带着回调参数。

### 两个联调台怎么切

用**路径**分，不引 react-router（整个站两个视图，一个 `pushState` + 一个
`popstate` 监听就够了）。为什么是路径不是 hash：X 的 Callback URI 登记的是路径
形态，而 fragment 压根不会随 302 发给任何一端；vite dev server 默认对无扩展名
路径做 SPA 回退，`/x/callback` 照样返回 `index.html`。

路径跟着 `vite.config.ts` 的 `base` 走（部署在 smartx-test 上时是 `/harness/`）——
写死 `/x/callback` 的话，部署版上那个地址会落到 business 的 API 根下而不是这个
页面，症状是从 X 跳回来看到一个 404，而地址栏里明明带着 code。

### 两套回调参数不会互相吃掉

页面现在同时接了 Privy 的 OAuth 回跳与 X 的绑定回调，两者会落在同一个地址栏
上。名字不撞：Privy 用 `privy_oauth_code` / `privy_oauth_state`，X 用
`code` / `state`。这条由 `src/xcallback.test.ts` 的用例钉住 —— 撞了的话，
X 那边会把 Privy 的授权码当成自己的送出去。

### 自检那两个探针**期望失败**

这是整合进来的东西里最反直觉的一条，所以判读逻辑从组件里搬进了
`src/selfcheck.ts` 并配了用例：

- 探针 1 匿名打 `GET /v1/user/info`，**拿到 `400000` 才叫通过** ——
  拒绝本身同时证明了代理通、信封层活着、这个后端认得这条路由。
  成功反而是异常（该端点是 Required 档，成功说明鉴权中间件没挂上）。
- 探针 2 用一个必然无效的 identity token 打 `POST /v1/auth/login`，期望
  `100108` / `400100`；**拿到裸 HTTP 404 就说明这个后端是旧构建**，
  这是区分新旧构建唯一的廉价办法。

两个探针**都跑完再回**，不在第一个失败时短路：同一台机器上一条回正常信封、
另一条回裸 404，这个对照正是"旧构建"而非"代理坏了"的判据。

### `ApiError` 从两类分成了三类

`business`（信封回来了，是业务拒绝）/ `transport`（HTTP 不是 200，没到信封层）/
`network`（fetch 自己抛了）。从前非 200 抛的是裸 `Error`，于是"这个后端没有这条
路由"与"这笔单被业务规则拒了"在 `catch` 里长得一样。

同时 `call()` 改成**一律先读 `text()` 再自己 `JSON.parse`**：非 200 时 body 多半
是一段 HTML（nginx / vite 的错误页），而 `resp.json()` 在那上面抛的是一句
"Unexpected token <" —— 那句话指向 JSON，而真相是路由不存在。响应体前 300 字符
留在 `rawBody` 里，HTML 错误页要能被一眼认出。

每个请求还带上了 `x-request-id`（32 位小写 hex，每次新生成）。它与回包的
`trace_id` 不一致 = 我们发的 ID 被后端判非法丢弃了，而契约说这是**静默失效**，
只能靠显式对比发现 —— `ErrorPanel` 里那句「不一致」就是这条的落地。

### X 绑定：三个"不是报错"的码

`200104`（没有生效的绑定）、`400103`（state 无效/过期/已被消费）、
`100113`（授权码已被用过）——**都是流程分支，不是故障**。判错一个就会把正常
状态渲染成红框，或者把"必须重新发起"说成"重试即可"，而后者最坑：重试一百次
都是同一个码。

还有两处照 proto 手推一定会错的地方，写在 `src/ximport.ts` 的文件头上：
零值字段**整个缺席**（`count` 为 0 时那个 key 根本不出现，判空只能用
`!count`），以及枚举**编成数字不是名字**（`follow_import.status` 是 1/2/3/4）。
两者写错都不报错，只是判断恒为 false。

### 已知会当场挡住 X 联调的几件事

这几条都不是这个页面能解决的，按顺序排查（原文在 demo 的 `NOTES.md`）：

- **测试服可能还没有这四条路由。** 2026-08-31 实测 `http://13.231.246.26:8080`
  上 `GET /v1/user/x/binding` 回**裸 HTTP 404**，而同一台机器上
  `POST /v1/auth/login` 回的是正常信封 —— 那台是 X 绑定合并之前的构建。
- **后端 `x.redirect_uri` 留空时四个端点只会回 `500097`**（`metadata.upstream=x`）。
- **X 官方文档没说明是否允许 `http://localhost` 作为 Callback URI，未实测。**
  所以页面**必须**保留「手工粘回调 URL」那条兜底路径 —— 它在任何 redirect_uri
  配置下都能用，哪怕回调页 404。别因为"自动路径通了"就把它删掉。
- **`sorsa.api_keys` 没配时绑定与档案照常可用**，只是关注导入不启动，表现是
  `follow_import.status` 一直是 1，页面轮询 2 分钟后停手。**别把这个当 bug 报上去。**
- **`status=2`（导入完成）的真实回包还没人见过**，后端 openapi 里那个示例注明是
  "按结构推算，未实测"。真跑通一次后 `count` / `synced_at` / `truncated` 的实际
  形态要回头核一遍。

## custom_auth link 是多余的，删了（2026-09-03）

登录之后那第四步 —— `linkWithCustomJwt(本站 JWT)`，把一个 `custom_auth` 账号挂到
同一个 Privy 用户上 —— **整条删掉了**，连同 `identity.ts` 的
`needsCustomAuthLink()`、`LinkNeed` 三值、`readiness()` 里那一格，以及页面上那枚
`custom_auth 已挂` 徽章。

### 它当初的理由，现在不成立了

理由是：business 查钱包走 `POST /users/custom_auth/id`，按
`custom_user_id = 我们的 identifier` 查 —— 于是不 link 就查无此人。

**后端已经不那么查了。** `app/business/internal/privysecurity/client.go` 现在走的是
`GET /users/<privy_did>`：登录时验过 Privy identity token，把
`(identifier, privy_did)` 原子落进 `app.users`，查钱包时先按 identifier 读这条
**本地已验签的映射**，再用 DID 去问 Privy。那个文件的注释很直白：

> 这里不能再要求 `custom_user_id = identifier`。custom_user_id 只有前端另走
> Privy Custom Auth 时才存在，而标准邮箱/社交登录只保证 DID。把 Custom Auth
> 当作资金端点的隐含前提，会出现"登录成功、钱包也存在，但入金/出金/交易都
> 查不到钱包"的断链。

改动是 `6751d44 fix(business): resolve Privy wallets by stored DID`，2026-09-03
03:52 UTC 部署到 smartx-test。来龙去脉在后端仓的
`docs/research/2026-09-03-privy-credentials-without-jwt-auth.md`（那是「方案 B」，
文档第 306 行明写：删的话前端 ④ 与 `needsCustomAuthLink` 一并可删）。

### 删它不只是清理，是解一个死锁

`linkWithCustomJwt` 要求 Privy 那侧开着 JWT-based auth。实测两个 app 都没开 ——
公开端点就查得到，不需要任何凭据：

```bash
curl -H "privy-app-id: <appId>" https://auth.privy.io/api/v1/apps/<appId>
# cmtb1g7g800l10dkzdlqi80zm ("SmartX App") → custom_jwt_auth: false
# cmt77j1bz00870cjorav46hyb ("condi")      → custom_jwt_auth: false
```

关着的时候那一步**当场 401，永远不可能成功**，而 `identity.ts` 对它的处置是硬停。
于是一条后端根本不需要的步骤，把整个下单按钮永久锁死了 —— 症状是身份卡下面那句
`卡在：custom_auth 还没 link —— 服务端查不到钱包`，而它指向的方向是错的。

### 两条留给下一个人的教训

**一、别从 harness 自己的注释反推后端行为。** 「business 按 custom_user_id 查」
这句话在本仓的注释里被复述了至少四处（`identity.ts` 文件头、`readiness()`、
README 两节），读起来像四份独立证据，其实是同一句话抄了四遍 —— 而它在后端改掉
之后一处都没跟着改。**判据只在 `smartx-backend` 的源码里**，那边还有用例钉着
（`client_test.go` 的「identifier 必须先经过本地已验签映射，不能假设用户另有
custom_auth 身份」）。

**二、那个前提当初就写偏了一点。** `identity.ts` 从前把成因写成「登录建出来的
Privy 用户身上只有 email 那条 linked account」—— 听起来像"多挂一条就好了"。
而真正的成因更靠前：那个端点在 **app 级别**就 401，挂不挂得上根本轮不到用户
这一层。这个偏差让人以为问题在自己的调用顺序上，而不是在一个控制台开关上。
