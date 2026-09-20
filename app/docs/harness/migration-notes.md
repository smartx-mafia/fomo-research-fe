# harness 迁移说明（实施后记）

| 项 | 值 |
|---|---|
| 文档类型 | **迁移后记** —— 写给三个月后接手的人 |
| 日期 | 2026-09-18 |
| 源仓库 | `~/workspace/smartx/meme/web-embedded-harness`（分支 `feat/fastswap-v2`，归档时 HEAD `15670e5`） |
| 目标 | `fomo-research-fe/app`，页面落为 `/dev/harness` |
| 与 `migration-spec.md` 的关系 | 规格是**迁移前**写的；本文是**迁移后**的事实。**两者冲突时以本文为准。** |

这份文档**不是**迁移方案的复述。它只记两件事：

1. **不能动的东西**，以及动了之后你会看到什么症状（症状通常不指向根因，这正是要写下来的理由）；
2. **已经踩过的坑**，让你不必再踩一遍。

每一条结论后面都尽量附了「出问题时你会看到什么」。如果你正在排查一个诡异问题，**先通读 §0 到 §3**。

### 2026-09-20：FastSwap 热路径已与正式页对齐

Harness 的交易卡不再等用户点击后才串行执行 Create。当前时序是：

1. 输入保持稳定 400ms 后，同时发起展示用 `/quote` 与 `POST /v2/swaps`；两者并行，展示报价的网络耗时不挡完整交易组装。
2. Create 复用原有 `SwapRun` 恢复记录与幂等键，只运行到 `preparation=READY`，不调用钱包、不产生用户签名、不上报 execution。
3. READY 后在用户点击前刷新 Privy 会话并预热 signer。Solana 使用一条带明确 non-authorizing 文案的空业务含义消息；EVM 只初始化 provider 并读取 chain id。预热失败会留下状态并放行最终签名。
4. 展示报价、READY 与预热都完成前，执行按钮保持禁用。点击时先把展示报价允许的最低到账写入同一笔恢复记录，再 GET 同一个 swap 对账当前 revision；若已过期只 refresh 同一笔，随后做签前核对、Privy 签名、可靠落盘与 `/executions` 上报。
5. 输入改变或被清空时，旧的已建未签 swap 先按原协议取消；只有取消已确认到终态才串行准备新意图，同一钱包不会并行 Create。用户确认前的本地记录不能从「恢复」入口签名。终态后可用「准备下一笔同参数」显式生成下一笔。

这次只调整 Harness 的调度与页面状态；FastSwap HTTP 契约、签名材料、签前/签后核对、恢复存储和后端均未改变。`flow.ts` 仍保留原 `run()`，用于已有调用兼容；新页面路径使用 `prepare()` + `executePrepared()`。

---

## 0. 部署硬要求（最高优先级）

> **【实施修正 · 2026-09-18，code review 之后】**
> 上面这条「必须显式设置」**已不再是硬要求**：`next.config.ts` 的 `env` 段现在
> 把 `NEXT_PUBLIC_ENABLE_HARNESS` 规整成确定的字面量 `'true'` / `'false'`，
> 于是变量未设置时打包器也能折叠那个三元，**留空现在等于关闭**。
> 实测：变量完全未设置做 clean build，`out/` 里搜「实跑台」「花真钱」
> 「确认并执行」「签前核对」「服务端代签授权」「harness.fastswap」
> 「LockBusyError」全部 0 命中；开关 `=true` 时它们回来。
> **但删掉 `next.config.ts` 里那段 `env` 就会退回到原来的危险默认**，
> 所以本节保留，作为那段配置存在理由的记录。


> ### Cloudflare Pages 的构建环境**必须显式设置** `NEXT_PUBLIC_ENABLE_HARNESS=false`。
> ### **留空不等于关闭。**

**根因**：Next 只内联环境里**存在**的 `NEXT_PUBLIC_*`。变量完全未设置时，
`process.env.NEXT_PUBLIC_ENABLE_HARNESS === 'true'` 这个表达式会**留到运行期**才求值，
打包器无从判死它 —— 于是 `next/dynamic()` 引的那一支照样被打成 chunk 进产物。
显式写成 `false` 之后，该表达式在构建期被折叠为常量 `false`，整支被摇掉。

**实测数据**（ticket 06 提交记录，按**产物内容**验证，不是按 chunk 文件名 —— 文件名是哈希的，
早先按文件名 grep 得出的「已排除」结论是**错的**，已在 ticket 06 修正）：

| 构建时的开关状态 | `out/` 里搜「实跑台」「花真钱」「确认并执行」 |
|---|---|
| **未设置** | **确实命中** —— harness UI 在生产产物里 |
| 显式 `=false` | **全部 0 命中**，**134KB** 的 harness UI 整块消失 |

**已知残留**：即使显式 `=false`，产物里仍有一个约 **16KB** 的 `(harness)` layout chunk。
它**只含 Privy 配置与 `createSolanaRpc`，不含任何 UI**。要消掉它需要把 Privy 配置移出
`(harness)/layout.tsx`，本次未做。

**症状**：如果哪天有人反馈「线上能搜到 harness 的字符串」或「产物里多了一百多 KB」，
第一嫌疑就是 Cloudflare Pages 的构建环境变量被清空了，而不是代码回退。

---

## 1. 三处不可删除 / 不可改回

### 1.1 `next.config.ts` 的两把锁 —— 生产构建排除 dev 代理

harness 的后端代理是一个 Route Handler：`src/app/api/harness/proxy/[...slug]/route.dev.ts`。
它**必须只在开发期存在**（理由见 §2）。做到这一点靠**两把锁，缺一不可**：

```ts
const isDev = process.env.NODE_ENV === "development";

// 第一把：只有开发期才把 dev.ts 认作 Route Handler 的扩展名
pageExtensions: isDev ? ["tsx", "ts", "jsx", "js", "dev.ts"] : ["tsx", "ts", "jsx", "js"],

// 第二把：开发期让 output 回到默认值，生产构建才是 "export"
output: isDev ? undefined : "export",
```

`next.config.ts` 里有一段长注释解释这两把锁。**动它们之前先读那段注释。** 提炼如下：

#### 第一把锁：`pageExtensions` 条件追加 `dev.ts`

Next 只把 `route.<pageExtensions 里的某一个>` 当成 Route Handler
（`node_modules/next/dist/server/lib/find-page-file.js` 的 `createValidFileMatcher`）。
文件叫 `route.dev.ts`，于是：开发期 `dev.ts` 在名单里 → 正常注册；
生产构建名单里没有 → 整个文件对 Next 只是一个普通同目录文件，不进路由表、不参与静态导出。

三种「顺手清理」的症状：

| 你做了什么 | 症状 | 症状指向哪里（**都不指向 next.config.ts**） |
|---|---|---|
| 把 `"dev.ts"` 从数组里删掉（"看着像没用的扩展名"） | dev 下 `/v1`、`/v2/swaps`、`/test-env/v1` **全部 404** | 页面上表现成「后端没起来」，你会去查 business / fastswap 进程 |
| 把 `pageExtensions` 写成常量数组（"分支太绕"） | `next build` 失败，报 Route Handler 与 `output: export` 不兼容 | 这条还算能指回来 |
| 把 `route.dev.ts` 改名成 `route.ts`（"统一命名"） | 同上，构建失败 | 同上 |

顺带：默认值 `["tsx","ts","jsx","js"]` 抄自 Next 自己的默认。这里只做**追加**，不做替换 ——
替换会影响**所有** page/layout 文件的识别。

#### 第二把锁：`output` 按 dev 分支

**这把锁比第一把更隐蔽。** `output: "export"` 一旦在开发期也生效，Route Handler
在 `next dev` 里**也被硬拦**（2026-09-18 实测）：每一发请求回 HTTP 500，终端打

```
⨯ export const dynamic = "force-static"/export const revalidate not configured
  on route "/api/harness/proxy/[...slug]" with "output: export"
```

**这条报错读起来像「你少写了一个 export」，是个陷阱。** 照它去加 `dynamic` 只会换来另一条
（`force-dynamic ... cannot be used with "output: export"`）—— 两条互斥，
在 `output: export` 下 Route Handler **无解**。所以开发期必须让 `output` 回到默认值。

**症状小结**：删第一把 → dev 下代理 404，看起来像后端挂了；
删第二把 → dev 下代理 500 + 一条误导你去改 `export const dynamic` 的报错。
两把锁哪一把被改成「生产也生效」，则 `next build` 当场失败 —— 那是**好事**，
真正危险的是反过来：如果有人让代理在生产构建里也被注册且构建居然过了，
就等于把一个**能任意转发到 business / fastswap 的开放代理**发上了线。

### 1.2 `reactStrictMode: false` 不可改回 `true`

`next.config.ts:9` 写着 `reactStrictMode: false`，上面有注释。**不要"顺手打开它"。**

**事故复述（2026-08-28）**：React StrictMode 在开发期会把 effect **跑两遍**。
Privy 的 `createOnLogin` 是**不幂等副作用** —— 双跑的结果是 `createOnLogin`
给同一个用户创建了**两个真实的、且不可删除的** Privy 嵌入式钱包。
Privy 没有删除钱包的接口，这笔账只能一直挂在那个账号上。

harness 的 `(harness)/layout.tsx` 用的是 `createOnLogin: 'users-without-wallets'`
（与宿主 `PrivyProviders.tsx` 的 `'off'` 不同，这是刻意的，layout 注释里点名了），
所以 harness 恰恰是这条 effect 的**主要触发者**。

**症状**：打开 StrictMode 后，一次登录之后「我」面板里会出现两个 SVM/EVM 地址，
或者地址与你上次记录的对不上。等你注意到的时候钱包**已经建好了，删不掉**。
这个症状不会报错、不会红，只会静悄悄多一只钱包。

### 1.3 `scripts/harness/privySign.ts` 不可移回 `app/src/`

这个模块 `import { createSign } from 'node:crypto'`，并读取
**Privy app secret** 与 **P-256 联签授权私钥**。它们等同于**对所有已授权钱包的代签权**。

源仓库靠「Vite 下浏览器导入会在解析 `node:crypto` 时构建失败」当护栏。
**迁到 Next 之后那道护栏不再可靠**，而宿主是 `output: "export"` 的**纯静态站点**，
**没有任何安全的服务端运行时可以承载它** —— 也就是说这里不存在「放进服务端代码就安全了」这个选项。
唯一安全的执行位置是**开发者本机的 Node 进程**。

**现在的护栏是物理隔离**，两道：

1. 文件在 `app/scripts/harness/` 下，**不在 `app/src/` 下**。Next 的模块图以 `src/app/**` 为根，够不到 `scripts/`。
2. `tsconfig.json` 的 `paths` 里 `@/*` **只映射 `./src/*`**。从应用代码里根本写不出指向它的别名路径 ——
   要引它只能写一条爬出 `src/` 的相对路径（`../../../scripts/...`），那是 code review 里一眼可见的动作，
   而不是一个顺手的 import。

**后果（如果有人把它挪回 `src/`）**：Next 会把它编进**客户端 bundle**，
等于把所有已授权钱包的代签权发给每一个访客。

**症状**：几乎没有症状 —— 这正是它危险的地方。构建会过，页面会正常渲染，测试会绿。
唯一的外部信号是 `out/` 里多出 `node:crypto` 相关的 polyfill 或构建报解析失败，
而这两条都可能被「加个 polyfill 就好了」糊过去。**移动这个文件之前，先想清楚它会被编进谁的 bundle。**

ticket 10 当时做过三重验证，复查时可照做：

- `app/src/` 全量 grep `privySign` / `privy-sign` / `scripts/harness`：零命中；
- 按浏览器平台打包该模块**当场失败**（`Could not resolve "node:crypto"`），对照 node 平台成功 ——
  复现的是 Next 客户端 bundle 的同一种解析语义；
- 真实 `next build` 产物（`out/` 478 文件 + `.next/`）搜该模块独有的中文串（压缩不删字符串字面量）：全部 0 命中。
  注意通用词如 `secp256k1_sign` 在产物里**有**命中，但溯源确认是 `@privy-io/react-auth` 自己的代码。

---

## 2. 这一页只在开发模式可用 —— 这是设计决定，不是缺陷

**因果链**（每一环都是实测的，不是推断）：

```
sx_fastswap 对任何携带 Origin 的请求返回裸 403 "origin not allowed"
        ↓
浏览器发起跨源请求时必然携带 Origin（这一条无法从前端规避）
        ↓
Origin 必须由一个服务端在转发前剥离掉
        ↓
宿主是 output: "export" 的纯静态导出站，托管在 Cloudflare Pages，线上没有任何服务端运行时
        ↓
线上打不开 /dev/harness，只能 `pnpm dev` 在本机用
```

**实测证据**（见 `migration-spec.md` §4.1）：

```
GET  https://sm-test-api.smartx.io/v1/user/info          + Origin
  → 200, access-control-allow-origin: *                  business 可浏览器直连

GET  https://sm-test-api.smartx.io/v2/swaps/capabilities  无 Origin
  → 200                                                   路由存在

GET  https://sm-test-api.smartx.io/v2/swaps/capabilities  + Origin
  → 403  "origin not allowed"                             致命
OPTIONS /v2/swaps                                          + Origin
  → 403
```

注意第三条与第二条**打的是同一个 URL**，差别只有一个请求头。

harness 在源仓库能跑，唯一原因是 `vite.config.ts:96-150` 的 proxy 在 `configure` 钩子里删掉了该请求头。
本仓库里这件事由 `route.dev.ts` 做（服务端 `fetch` 天然不带 `Origin`）。
Next 的 `rewrites()` **无法删除请求头**，所以 `/v2/swaps` 必须走 Route Handler，绕不过去。

**已确认接受**：不申请 fastswap 的 CORS 白名单（那是扩大攻击面），也不为 harness 给宿主引入服务端运行时。

**症状**：如果有人在线上地址访问 `/dev/harness`，看到的是 404（页面总开关关闭时的预期行为），
而不是一个报错页。**404 是正确的**，不要去"修"它。

---

## 3. 本机环境的前置进程清单

「本机」档依赖**多个独立进程**。任一未起都表现为**难以归因**的失败 —— 症状几乎从不指向缺失的那个进程。
按下面这张表逐条核对，比读日志快得多：

| # | 依赖 | 默认地址 | 缺了会看到什么症状 |
|---|---|---|---|
| 1 | `sx_business` | `:8080`（`BUSINESS_ORIGIN`） | 登录、用户信息、持仓、board 全部失败。代理转发时连不上上游，页面上表现为请求挂起或 5xx。**这条是最容易识别的一条**，后面几条都不是 |
| 2 | `sx_fastswap` | `:8082`（`FASTSWAP_ORIGIN`） | Swap 卡在第一步：`capabilities` / `quote` 拿不到。若误把 `FASTSWAP_ORIGIN` 指向测试环境而**绕过了代理**，症状换成裸 `403 origin not allowed`（见 §2） |
| 3 | **`sx_fastswap_worker`** | 与 fastswap 同机 | **最隐蔽的一条。** 建单成功、报价成功、签名成功、`executions` 也回 `ACCEPTED` —— 然后**永远停在那儿**。轮询一直是非终态，`outcome` 永远不是 `COMPLETED`。页面上看不出任何错误，只是"一直在转"。看到「swap 走不到终态且无任何报错」，**先查 worker 是否在跑** |
| 4 | `business` 的**内部 gRPC** | `127.0.0.1:18000` | **所有钱包创建返回 `500097`。** 注意 business 的 HTTP 口（:8080）可能完全正常，所以你会以为 business 是好的。这个端口承载 `Directory.ListUserWallets`，未暴露时钱包链路整体不可用 |
| 5 | **已注资的 sponsor 账户** | — | 真链动作（转出 / swap 落链）会因缺少代付而失败。症状取决于后端，通常不是一个能自解释的错误码。**这一条不会在 dev 启动时报出来，只会在你真花钱那一刻炸** |

另外两条环境约束（不是进程，但同样会让你白排查半天）：

- **必须用 `localhost` 访问，不能用 IP。** Privy 强制 HTTPS，`http://<IP>` 会在渲染期抛错**白屏**。
- 「测试环境」档的可用性取决于 `NEXT_PUBLIC_HARNESS_TEST_PRIVY_APP_ID` —— 缺失则该档**禁用**（标签页不可选）。

---

## 4. 怎么从零跑起来

### 4.1 装依赖 —— **必须 `npx pnpm@10`**

```bash
cd /path/to/fomo-research-fe/app
npx pnpm@10 install
```

**不要用本机的 `pnpm`。** `pnpm-lock.yaml` 是 **lockfileVersion 9.0**，需 pnpm 9+；
本机全局仍为 **8.15.4**，它会把锁文件**降级重写为 6.0 并重解析整棵树**。

**症状**：`git status` 里 `pnpm-lock.yaml` 出现一个巨大的、你没打算做的 diff；
更糟的是依赖版本被悄悄重解析，而安装过程**不报任何错**。
（`corepack` 在本机不可用，所以只能走 `npx pnpm@10`。）

安装后核对：锁文件仍是 9.0；6 个原生依赖就位 —— `keccak` / `bigint-buffer` / `bufferutil` /
`utf-8-validate` 有 `.node` 产物，`esbuild` 与 `sharp` 走平台预构建包。

### 4.2 配 `.env.local`

以 `app/.env.example` 为模板（harness 那一节注释写得很细，照着填）。开本机调试至少要：

```dotenv
NEXT_PUBLIC_ENABLE_HARNESS=true          # 页面总开关，必须**字符串 true**
NEXT_PUBLIC_HARNESS_PRIVY_APP_ID=...     # 「本机」档的 Privy app id（不是凭据）
NEXT_PUBLIC_HARNESS_TEST_PRIVY_APP_ID=...# 「测试环境」档的总开关，缺失则该档禁用
NEXT_PUBLIC_SOLANA_RPC_URL=...           # 复用宿主既有变量
BUSINESS_ORIGIN=http://127.0.0.1:8080    # 无 NEXT_PUBLIC_，只有代理读
TEST_BUSINESS_ORIGIN=https://sm-test-api.smartx.io
FASTSWAP_ORIGIN=http://127.0.0.1:8082
```

`NEXT_PUBLIC_HARNESS_KEY_QUORUM_ID` 缺失则「授权联签」按钮禁用（不是报错，是**灰掉**）。

### 4.3 起本机后端

按 §3 的清单把 5 项都起起来。

### 4.4 跑

```bash
npx pnpm@10 dev
# 浏览器打开 http://localhost:3000/dev/harness   —— 必须是 localhost，不能是 IP
```

页面上应当有：顶栏 + 环境切换 + 「我」popover + **实钱警告横幅** + 交易卡（Swap / 转出）+ 持仓卡 + 右栏过程日志。

### 4.5 三个 CLI 脚本

它们跑在 **Node** 里，与页面无关，变量**没有** `NEXT_PUBLIC_` 前缀：

```bash
npx pnpm@10 run harness:probe        # 只读延迟探针：GET /v1/meme/chains + GET /v1/portfolio
npx pnpm@10 run harness:universe     # 无鉴权拉 5 个 board，去重分层，写 .harness-out/universe.json
npx pnpm@10 run harness:privy-sign   # Node 侧 Privy 服务端代签（见下，属审批线）
```

- `harness:probe` 需要 `HARNESS_API_ORIGIN` + `HARNESS_TOKEN`。
  **注意：测试环境上 `/v1/meme/chains` 也要 bearer**（详见 §6），
  无有效 token 时脚本会在第一发请求就停住，不会跑到第二发。
- `harness:universe` 输出默认 `.harness-out/universe.json`（`HARNESS_OUT` 可改）。
  **不要改成 `out/`** —— 那是 `next build` 的静态导出目录，每次构建被整个重写，名单会被**静默删掉**。
  实跑参考：打真实测试环境，5 个 board、去重分层后 **168 个标的**，约 50KB。
- **`harness:privy-sign` 属私钥审批线。** 它读 app secret 与 P-256 联签私钥。
  **这两个变量只在命令行前缀里临时给，不要写进任何 `.env*` 文件** —— 那是一份躺在磁盘上的明文：

  ```bash
  PRIVY_APP_ID=... PRIVY_APP_SECRET=... PRIVY_AUTHZ_KEY=~/path/to/key.pem \
    npx pnpm@10 run harness:privy-sign
  ```

  （迁移过程中该脚本**只验到「缺环境变量」那一步即停**：未去找、未使用任何真实 app secret
  或联签私钥，未向 Privy 发出任何请求。）

---

## 5. 代码形态：免责声明

> **`src/features/harness/**` 是归档移植的原样形态，不代表本仓库认可的写法。**

具体来说：

| 现象 | 规模 |
|---|---|
| `App.tsx` 单文件 | 源仓库 2186 行，迁入后 2172 行（X 绑定分支删除所致） |
| 状态管理 | **全部 `useState` 平铺**，无 store、无 reducer |
| 样式 | `ui.tsx`（源 1011 行 / 迁入后 1023 行）里塞着**整套 CSS 字符串**，仓库内该模块零 CSS 文件 |
| UI 层测试覆盖 | `App.tsx` / `ui.tsx` / `SwapPanel.tsx` **零覆盖**（测试全在 node 环境，无 jsdom） |

这是「**原样搬**」这条决策的**已知代价**，而不是疏忽。原样搬换来的性质是：
迁入的文件能与归档仓库**逐文件 diff**。ticket 05 的 15 个文件与源仓库逐字节比对，**总共只有 2 行改动**；
ticket 06 的 `errors.tsx` 是 0 行差异，`SwapPanel.tsx` 仅 +2 行。这个性质一旦被"顺手重构"打破就再也回不来了。

**写新代码请参照 `src/features/fast-swap/` 的模块形态，不要参照这里。**

风险登记在 `migration-spec.md` R9：「文档挡不住模仿，这是已接受的代价」。
如果将来要重构 harness，那是一个**独立任务**，不要和任何其他改动混在同一个 diff 里。

---

## 6. 已裁决的文档 / 代码冲突

裁决顺序：**代码 > 测试 > 文档**。下面每一条都已裁决，**不要再按归档 README 的说法行动**。

### 6.1 `@solana-program/{memo,system}` —— **保留宿主既有的直接声明，未删**

`migration-spec.md` §4.5 / 决策 25 原本写的是「删除直接声明」。**该决策未执行，且事实前提已被证伪。**

决策的事实前提是「这是 harness 的死依赖」。实际情况是：**它们是宿主自己早就声明的依赖**
（`app/package.json` 里 `@solana-program/memo` 与 `@solana-program/system` 各有一条直接声明），
harness 的 `package.json` 根本不参与迁移。删它们等于改动**宿主既有的依赖集**，
而且二者作为 `@solana-program/token` 的传递依赖无论如何都在树里 —— **收益为零，风险非零**。

**源仓库 README 那条警告的原文（照抄，不改写）**：

> ### 别删 `@solana-program/{memo,system,token}`
>
> `src/` 里一次都没 import 它们，看起来是三个没人用的依赖 —— **但它们是
> `@privy-io/react-auth` 的 optional peer dependency**，消费者是 Privy 的
> `solana.mjs`，不是我们的代码。删掉之后 `npm test` 与 `npx tsc --noEmit`
> **照样全绿**，只有 `npm run build` 会失败：
>
> ```
> "getAddMemoInstruction" is not exported by
> "__vite-optional-peer-dep:@solana-program/memo:@privy-io/react-auth:false"
> ```
>
> 判据是"谁在 import 它"，而不是"我们的 src 里有没有它"。
> 2026-08-28 按后者判过一次，当场把构建删坏了。

**症状**：如果有人日后跑 `knip` / `depcheck` / `ts-prune` 之类的死代码工具，
这两个包会被报成「未使用的依赖」。**那是误报**，先读上面这段原文。

### 6.2 business 的 CORS 头 —— 源 README **已过时**

| 说法 | 出处 | 裁决 |
|---|---|---|
| 「business 不发 CORS 头」 | 源 README | **对测试环境已过时** |
| 实测 `GET /v1/user/info` + `Origin` → `200`，`access-control-allow-origin: *` | `migration-spec.md` §4.1 | **以实测为准** |

也就是说 business 是**可以浏览器直连**的。**只有 fastswap 不行**（§2）。

### 6.3 test-env v2 —— 源 `PROGRESS.md` **已过时**

| 说法 | 出处 | 裁决 |
|---|---|---|
| 「test-env v2 未接通」 | 源 `PROGRESS.md` | **已过时** |
| 实测 `GET /v2/swaps/capabilities`（**无 Origin**）→ `200` | `migration-spec.md` §4.1 | 路由存在 |

### 6.4 `/v1/meme/chains` 的鉴权 —— 源 README / `probe.ts` 暗示错了

源 README 与 `probe.ts` 把它当成「只读、无鉴权」的探针端点。
**实测：测试环境上 `/v1/meme/chains` 也要 bearer**，不是只有 `/v1/portfolio` 要。

**症状**：`harness:probe` 在**第一发**请求就停住，而不是像你预期的那样跑到第二发。
这不是脚本坏了。（ticket 10 用一个不含任何凭据的本地假后端把完整两发路径验证完毕。）

---

## 7. 本次未迁移的内容

### 7.1 X 绑定台（5 个模块 + 1 个测试文件）

| 文件 | 说明 |
|---|---|
| `XBindPage.tsx` | 源仓库 716 行 |
| `useXBind.ts` | |
| `xcallback.ts` | |
| `xpending.ts` | |
| `ximport.ts` | |
| `xcallback.test.ts` | 随之失去被测对象 |

harness 顶栏的「打开 X 绑定台」改为**整页跳转**到宿主的 `/login/x`（用 `<a href>` 而非软导航 ——
离开 harness 就把这一页状态一起丢掉，比留一份半活的更诚实）。

**随之丢失的两项能力**（宿主 `/login/x` **不具备**）：

1. **unbind**（解绑）；
2. **follow-import 轮询** —— **5 秒间隔 / 120 秒截止**。

**症状**：如果有人来问「以前 harness 上能解绑，现在怎么没有了」，答案是这里 —— 它没坏，是没搬。
需要这两项能力时，要么去归档仓库翻，要么在宿主 `/login/x` 上实现。

### 7.2 连带收益（不是损失）

`App.tsx` 的**手写路由**（`history.pushState` + `popstate` 监听）**存在的唯一理由**就是 X 绑定这第二个视图。
砍掉后 harness 成为**单视图页面**：

- 「手写路由须改造为 `next/navigation`」这个迁移风险项**直接消失**；
- `import.meta.env.BASE_URL` 的最后一个使用点**一并消失**。

注意：删 X 绑定分支后剩下那一支 JSX **没有回退缩进**。这是刻意的 ——
重排会塞进近 300 行纯空白 diff 把真正的改动淹掉，而可对照性正是原样搬的全部意义。
（当时用 `diff -u` 与 `diff -w -u` 给出同样的 99 行，证明未引入任何纯空白改动。）
**如果你的编辑器/格式化工具想帮你"修正"这块缩进，拒绝它。**

---

## 8. 已知遗留缺陷（不修，但你该知道）

下面 5 条**全部已知、全部未修**，理由各异。记在这里是为了让你在遇到时不必重新调查一遍。

### 8.1 `api.ts` 的 env 耦合 —— **护栏是脆的**

`src/features/harness/api.ts` 直接 `import` `envs.browser` 来取 `API_PREFIX`。
`envs.browser` 在**模块顶层就读 `localStorage`** —— 于是这段浏览器代码被拖进了
**Node 脚本的导入链**。

**今天的症状**：每次跑 `harness:*` 脚本都会打一条 `ExperimentalWarning`。仅此而已，不致命：

- `readStored` 有 `try/catch`，Node 里会退回**默认档**；
- 脚本一律先调 `setBaseOrigin`，而 `resolveUrl` 里 `baseOrigin` **优先于** `prefix`。

**但护栏是脆的**：哪天有个脚本忘了 `setBaseOrigin`，它会**静默地**连上**默认档**的后端 ——
没有报错、没有警告，只有一个打错了环境的结果。**如果某个脚本的输出看起来"不像这个环境的数据"，先查这里。**

这是**源仓库就有的耦合，不是迁移引入的** —— `transport.ts:120-126` 的注释写的正是要避免它，`api.ts` 没照做。
按「不重构」的既定决策保持原样。

### 8.2 开发期 `output` 不再是 `"export"` —— 反馈回路退化

见 §1.1 第二把锁。代价是：**静态导出的各项约束只在 `next build` 时才被强制**，
开发期写出的「只有服务端才能跑」的代码不会当场报错。

**这是全项目范围的反馈回路退化，不是 harness 的局部代价** —— 它影响的是每一个在这个仓库里写页面的人。

**缓解（务必执行）**：**提交前 / CI 必须跑 `next build`。** 光跑 `next dev` 和 `vitest` 不够。

```bash
npx pnpm@10 exec next build
```

### 8.3 宿主 `OAuthCard.tsx` 里的 `VITE_*` 变量名 —— 宿主自己的同类缺陷

`app/src/components/OAuthCard.tsx:91-92` 在**界面上**写着
`VITE_ENABLE_GOOGLE=true` / `VITE_ENABLE_APPLE=true`，
于是产品 `/login` 页会向用户显示一个**本项目根本不存在的变量名**（本项目用的是 `NEXT_PUBLIC_ENABLE_*`）。

**这是宿主自己的缺陷，不是迁移引入的**，也不在本次范围，**未改**。
（harness 内部同类的 12 处 `VITE_*` 错误文案已在 ticket 06 修掉。）

**症状**：有人照着 `/login` 页的提示去 `.env.local` 里加 `VITE_ENABLE_GOOGLE=true`，然后发现毫无效果。

### 8.4 `ui.tsx` 里 `.narrow` 已成死 CSS

`src/features/harness/ui.tsx:235` 的 `.narrow { max-width: 980px; }` 唯一的使用点随 X 绑定台一起被删了。
**未删** —— 删 CSS 不是迁移的必需动作，而任何一处非必需改动都在削弱「与归档仓库可对照」这个性质。

### 8.5 既有测试失败：`FastSwapPage.auto.test.tsx` 11 条

`src/features/fast-swap/FastSwapPage.auto.test.tsx` 有 **11 条失败**，
失败点是 `beforeEach` 里 `vi.useFakeTimers()` 一行抛
`TypeError: Cannot read properties of undefined (reading 'clear')`。

**迁移前就是红的** —— ticket 01 采集的基线（见迁移首个 commit 的 message）即为
`11 failed | 524 passed | 1 skipped`，且失败全部集中在这一个既有文件。
**不在本次范围**，未修也未 skip。

**症状**：你跑全量 `vitest run` 会看到 11 条红。**那是基线，不是你弄坏的。**
判据是「红的条数与文件是否与基线一致」——多一条都要查。

---

## 9. 测试现状

| 项 | 数量 |
|---|---|
| harness 自己的测试文件 | **17** 个（在 `src/features/harness/**`） |
| harness 用例 | **274** |
| `privySign.test.ts`（在 `scripts/harness/`） | **21** |
| **harness 合计** | **295，全绿** |

源仓库共 **19** 个测试文件；减去 `privySign.test.ts`（单独落在 `scripts/harness/`）与
`xcallback.test.ts`（已决定不迁移）= 17。

跑法：

```bash
npx pnpm@10 exec vitest run src/features/harness   # 17 文件 / 274 用例
npx pnpm@10 exec vitest run scripts/harness        # privySign.test.ts / 21 用例
npx pnpm@10 exec vitest run                        # 全量；失败应当只有 §8.5 那 11 条
```

### 整个迁移**只改过一处测试**

`signers.test.ts` 里的**一个字符串断言**，跟着变量重命名（`VITE_*` → `NEXT_PUBLIC_HARNESS_*`）改了。
**断言含义未削弱**，只是被断言的那个变量名换了。

**没有删过任何断言，没有加过任何 `skip`，没有改过任何测试来让它变绿。**

这一条值得写下来的原因是：它是判断「后续某次改动有没有偷偷动测试」的**基线**。
如果日后 `git log` 里出现第二处测试改动而没有明确理由，那是一个需要问清楚的信号。

---

## 10. 延伸阅读

| 文档 | 内容 | 注意 |
|---|---|---|
| [`README.md`](./README.md) | 48KB 运维圣经，harness 的一切细节 | **归档原文**，其中 Vite / dev server / 部署部分已不适用；且本文 §6 列的几条说法已被推翻 |
| [`CONTEXT.md`](./CONTEXT.md) | 领域模型 / 术语表（Swap / Intent / Revision / Signed artifact / Execution / Completed 的精确含义） | **归档原文**，术语部分仍然完全有效，**这份最该先读** |
| [`adr/0001-harness-v2-only-reference-impl.md`](./adr/0001-harness-v2-only-reference-impl.md) | 为什么只走 Fast Swap v2、为什么删掉 v1 不留开关 | 归档原文 |
| [`privy-examples-survey.md`](./privy-examples-survey.md) | `privy-io/examples` 调研（§5.2 实测：Vite 与 Next starter 在钱包动作层仅差 4 行） | 归档原文 |
| [`migration-spec.md`](./migration-spec.md) | 迁移技术方案（**迁移前**写的） | 已就四处被实践推翻的地方加了「实施修正」标注；与本文冲突以**本文**为准 |
| `app/docs/privy-login/*.md` | 宿主既有的 7 份 Privy 契约文档 | 宿主自己的文档，非归档 |
| `app/.env.example` | harness 那一节的注释写得很细 | 配环境时照着读 |
