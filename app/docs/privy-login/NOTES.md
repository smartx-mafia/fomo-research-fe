# 待补充 / 已知缺口

> 这份留给你往里加。下面是 2026-08-28 建站时已知的项。

## 上线前必做

- [ ] **CORS**。后端 business 不发 `Access-Control-Allow-Origin`（实测 `OPTIONS`
      回 404，是后端已知缺口表里的活）。本项目用 dev server 同源代理绕开，
      **那条路上线不存在**。两条正路：①网关把前端与 API 摆在同一个源下；
      ②business 补一层可配 Origin 白名单的 CORS 中间件。
      **不要照抄这个前端的代理去部署。**
- [ ] **Privy 控制台 allowed OAuth redirect URLs**：当前**留空 = 不限制**。
      上线前必须填正式域名（要求 HTTPS、精确匹配、不许通配符/query/尾斜杠）。
- [ ] **Privy 控制台 `allowed_domains`**：当前 `[]`（不限制）。收紧到正式域名时，
      本地调试用的 `http://localhost:7500` 与远程联调入口
      `http://13.52.177.63:7500` 也要在列，否则调试就用不了了。
- [ ] **（可选，品牌）验证码邮件的发信域名**。当前是 Privy 的默认发信方，
      用户收到的邮件署名不是 SmartX。改成自有发信/回复地址 + logo 属
      **Privy Enterprise 专属**，只能联系 sales@privy.io 开通，Dashboard 里
      没有自助开关、也不需要我们自己配 SPF/DKIM。**我们这边零代码改动。**
      与之无关的另一件事：Dashboard → App settings → Domains 可以自助填
      自有域名，那管的是 HttpOnly 第一方 cookie，不是发邮件。
- [ ] 换成正式环境的 Privy app 与后端地址（测试与正式是**两个 app、两套凭据**，
      拿错 app 的 identity token 一律 `400100`）。

- [ ] **X 开发者后台的 Callback URI** 换成正式域名，并与后端
      `configs/business.yaml` 的 `x.redirect_uri` **逐字符一致**
      （差一个斜杠、差 http/https，X 就拒绝授权码，且只回 `invalid_request`）。

## X 账号绑定：未实测 / 待后端（2026-08-31）

用法见 [`docs/x-bind.md`](docs/x-bind.md)。下面这几条都会**当场挡住联调**，
按顺序排查：

- [ ] **测试服还没有这四条路由。** 实测 `http://13.231.246.26:8080` 上
      `GET /v1/user/x/binding` 回**裸 HTTP 404**，而同一台机器上
      `POST /v1/auth/login` 回的是正常信封（`400100`）—— 那台是 X 绑定合并
      之前的构建。页面会把这句话直接说出来，不用去查鉴权或代理。
- [ ] **后端 `x.redirect_uri` 当前留空。** 即便换上带 X 路由的构建，
      不填这一项四个端点也只会回 `500097`（`metadata.upstream=x`）。
- [ ] **X 官方文档没有说明是否允许 `http://localhost` 作为 Callback URI，
      未实测。** 所以本页**必须**保留「手工粘回调 URL」那条兜底路径 ——
      它在任何 redirect_uri 配置下都能用，哪怕回调页 404。
      别因为"自动路径通了"就把它删掉：换个环境它就是唯一能走的路。
- [ ] `sorsa.api_keys` 没配时**绑定与档案照常可用**，只是关注导入不启动 ——
      表现是 `follow_import.status` 一直是 1，页面轮询 2 分钟后停手。
      别把这个当成 bug 报上去。
- [ ] **`status=2`（导入完成）的真实回包还没人见过。** 后端的 openapi 里那个
      示例注明是"按结构推算，未实测"（e2e 的假上游只实现了 token 与 users/me
      两个端点）。真跑通一次后，`count` / `synced_at` / `truncated` 的实际
      形态要回头核一遍。
- [ ] 档案字段值（`avatar_url` 的形态、`public_metrics` 的量级）同样来自测试
      替身，接真实 X 账号后按实测更新。

## 控制台待开（代码已就绪，不用改）

- [ ] Google 登录：当前 `google_oauth: false`
- [ ] Apple 登录：当前 `apple_oauth: false`

开法见 `docs/privy-setup.md`。开完还要在 `.env.local` 里把
`VITE_ENABLE_GOOGLE` / `VITE_ENABLE_APPLE` 置 `true`（两道闸）。

## 后端已知限制（不是本前端能解决的）

- **没有 refresh 机制**。本站 JWT 3 天过期，只能重走一次完整登录。
  叠加 Privy 会话约 1 小时，意味着**真实用户在第 3 天会被无预警强制重登** ——
  这是个产品级问题，值得反馈给后端。
- **`user:info` / `user:auth` 两张 Redis 缓存没有 TTL**，唯一失效通道是
  `UserUsecase.InvalidateUser`。手工改库（比如 SQL 封号）不删缓存的话，
  `/v1/user/info` 会一直返回旧值且**没有自愈窗口**。
- 本站 JWT 没有 `sub`，用户键叫 `identifier`。

## 本前端的范围

- 只覆盖 **email OTP**；Google/Apple 代码就绪但控制台未开。
- X 账号绑定覆盖了四个端点的全流程（发起 / 完成 / 查询+轮询 / 解绑）与两条
  回调路径。**没有做**：多账号切换、关注列表本身的展示（后端目前也不给列表，
  只给条数）、绑定次数配额的可视化。
- 后端 v1 只开 email/google/apple 三种 `auth_method`，wallet / twitter /
  telegram / passkey 等一律回 `100107`（预留位）。
- 不建钱包（该 app `create_on_login: off`），所以 `app.user_account` 预期 0 行。
- 没有做：注册后的 onboarding、资料编辑、封禁/注销态的完整展示。

## 想到再加

- [ ]
