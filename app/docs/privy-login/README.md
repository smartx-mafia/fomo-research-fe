# smartx-login-fe

SmartX 后端**用户域登录**的联调前端。

> **这是契约验证台，不是产品登录页。**
> 它的产出物是「哪一步失败了、什么六位码、哪个 trace_id」，不是「登录成功」四个字。
> 所以它刻意不自动重登、不吞错误、失败就停在原地让人看得见。

它跑通并**用数据库落行证明**这条链路：

```
Privy email OTP 登录 ──> identity token ──> POST /v1/auth/login ──> 本站 JWT
                                                                      │
                                        localStorage  ←───────────────┤
                                                                      ↓
                                              GET /v1/user/info（Bearer）
```

## 五分钟跑起来

```bash
npm install
cp .env.example .env.local     # 默认值就能用，不用改
npm run dev                    # http://localhost:7500
```

打开页面后**第一个该点的按钮是「0 · 后端自检」** —— 它不碰 Privy，
只回答「后端够不够得着、是不是带登录的那个构建」。两个探针都绿了再往下走。

| 步骤 | 卡片 | 期望 |
|---|---|---|
| 0 | 后端自检 | 探针1 拿到 `400000`、探针2 拿到 `400100` |
| 1 | 邮箱验证码登录 | 收码 → 输码 → Privy 卡片变「已登录」，且 identity token 自检三项全绿 |
| 2 | 换取本站 token | 拿到本站 JWT、`identifier`、`is_new` |
| 3 | 验证 | `GET /v1/user/info` 回的 `identifier` 与登录返回的一致 |

## 第二个联调台：X（Twitter）账号绑定

顶部导航切过去，或直接开 `http://localhost:7500/x`。它验的是另一条链路：

```
POST /v1/user/x/bind/start → 跳 x.com 授权 → 回调带 code+state
      → POST /v1/user/x/bind → 轮询 GET /v1/user/x/binding 看关注导入进度
```

**四个端点全部要求本站 JWT**，所以先在登录台换到 token 再过去。
用法、redirect_uri 的两条回调路径（自动 / 手工兜底）、四种导入状态与码表
都在 [`docs/x-bind.md`](docs/x-bind.md)。

两个联调台**共用同一份事件日志**，切来切去不会把线索弄丢。

## 技术栈

React 19 · TypeScript · Vite 7 · Tailwind v4 · shadcn/ui · `@privy-io/react-auth` 3.38 · npm

> **为什么是 Vite 7 而不是 8**：Vite 8 的 rolldown 对 Privy 那些
> optional peer 依赖（`@solana/kit` 等）会报 MISSING_EXPORT 直接构建失败。
> Vite 7 + `@vitejs/plugin-react@5` 是与 Privy 3.38 实测可用的组合
> （后端仓的 `web/embedded-harness` 用的也是这一档）。
>
> `@solana/kit`、`@solana-program/*` 装了但**运行时用不到** —— 纯登录页不签任何交易，
> 装它们只是为了让打包器解析得了 Privy 内部那些 import。

## 同源代理：这是绕开 CORS，不是图方便

后端 business **不发 `Access-Control-Allow-Origin`**（实测 `OPTIONS /v1/auth/login`
直接回 404，是后端已知缺口）。浏览器里跨源打它预检就被拦下，而 fetch 抛的
`Failed to fetch` 与「后端没起来」长得一模一样。

所以浏览器代码**一律打相对路径 `/v1`**，由 dev server 同源代理转发。

> **真上线时这条路不存在。** 要么网关把前端与 API 摆在同一个源下，
> 要么 business 真的补 CORS —— 那是后端缺口表里的活。
> **不要照抄这个前端的代理去部署。** 详见 `NOTES.md`。

## 文档

| 文件 | 内容 |
|---|---|
| [`docs/backend-contract.md`](docs/backend-contract.md) | 端点、请求体、恒 200 信封、六位码表、几条红线 |
| [`docs/x-bind.md`](docs/x-bind.md) | X 账号绑定：五步剧本、redirect_uri 两条路、导入状态、码表 |
| [`docs/privy-setup.md`](docs/privy-setup.md) | appId/clientId、identity token vs access token、怎么开 Google/Apple |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | 症状 → 原因表 |
| [`docs/verification.md`](docs/verification.md) | 端到端验收剧本（含 psql 断言） |
| [`NOTES.md`](NOTES.md) | **待补充**：上线前必做、已知缺口。留给你往里加 |

## 脚本

```bash
npm run dev        # 开发服务器，0.0.0.0:7500
npm run build      # tsc -b && vite build
npm run lint       # oxlint
npx tsc -b --noEmit  # 只做类型检查
```
