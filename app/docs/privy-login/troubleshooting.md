# 症状 → 原因

先跑页面上的「0 · 后端自检」。它把「后端够不够得着」从「登录能不能成」里切出来 ——
没有这一层的话，后端/CORS 不通、后端是旧构建、identity token 过期三件事症状都是「登录失败」。

| 症状 | 原因 | 怎么办 |
|---|---|---|
| `Failed to fetch` / 自检探针1 报 network | 后端不可达、HTTPS 页面请求 HTTP 被拦，或后端 CORS 未放行 | 检查 `.env.local` 的 `NEXT_PUBLIC_BUSINESS_API_BASE` 与浏览器 Console；**改完要重启 dev server** |
| `/v1/auth/login` 回 **HTTP 404** | **这个后端是旧构建**，没有登录路由 | 指向测试服浏览器入口 `https://sm-test-api.smartx.io` |
| 回包是 HTML、JSON 解析失败 | API 地址指向了网页或错误网关 | 检查 Network 中的真实 Request URL 与 Response，改正 `NEXT_PUBLIC_BUSINESS_API_BASE` |
| 登录回 `400100` | ① identity token 过期（>1h）② appId 与后端 `privy.app_id` 不一致 | 先看 Privy 卡片上「identity token 剩余」。页面会自动重取并重试**一次**；仍失败就是 appId 不匹配或 Privy 会话已死 |
| 点「换取」报 `identity token 取不到（null）`，但 Privy 明明已登录 | 该 Privy app 没开 identity token（Dashboard 默认关） | Dashboard → User management → Authentication → Advanced → 打开「Return user data in an identity token」。坐实：带 Privy access token 打 `GET https://auth.privy.io/api/v1/users/me`，回包 `identity_token: null` 即是 |
| 登录回 `100107` | 声称的 `auth_method` 不在 token 的 linked_accounts 里 | 看 Privy 卡片上的「绑定」列表 —— email 登的却按了 Google 就是这个码。换取按钮上标了「未绑定」的就是会撞这个码的 |
| 登录回 `100108` | identity token 是 null 或超 8192 字节 | 多半是 token 没取到就发了出去。重新登录 Privy |
| 登录回 `420102` | 连点了登录按钮，撞上后端防重入（锁 TTL 10s） | 等上一发返回。按钮本来就该在请求期间禁用 |
| 登录回 `420000` | 触发限流（IP 层 20 rps / burst 40） | 退避几秒 |
| 登录回 `500097` | 这个环境没配 Privy 或数据库 | 换后端，或找运维 |
| `/v1/user/info` 回 `400000`，但刚登录成功 | ①切换过 `NEXT_PUBLIC_BUSINESS_API_BASE`，旧 token 是别的后端签的 ②JWT 过期（3 天） | 页面会显示「这个 token 不是当前后端签的」。重新换取即可，**不要去查验签** |
| 同一个验证码试了几次就不行了 | 同一 OTP 最多 5 次 | 重新「发送验证码」 |
| Google/Apple 按钮点不亮 | Privy 控制台没开 + 本地硬闸没开 | 见 `privy-setup.md`。**不是本页的 bug** |
| 复制按钮报「复制失败」 | 当前不是安全上下文（用 `--host` 从局域网 IP 访问） | 用 `http://localhost:7500` 访问。按钮已经把失败显示出来了 —— 静默失败才是真麻烦 |
| 白屏 | ①缺 `VITE_PRIVY_APP_ID` ②React 树里抛了异常 | 缺配置会直接显示缺哪个；异常被 ErrorBoundary 挡住并打印堆栈。都不会真白屏 |
| 刷新后登录态没了 | localStorage 写不进（隐私模式/企业策略） | 页面顶部会显示「写不进 localStorage」。**不是登录失败** |
| Tailwind 类名不生效 | 残留了 v3 时代的 `postcss.config.js` / `tailwind.config.js` | v4 走 `@tailwindcss/vite` 插件，本项目里那两个文件不该存在 |
| `npm run build` 报 `MISSING_EXPORT ... @solana/kit` | 用了 Vite 8（rolldown），或缺 Privy 的 optional peer | 本项目锁 Vite 7 + `@vitejs/plugin-react@5`，并装了 `@solana/kit`、`@solana-program/*` |
| `shadcn init` 报 "No import alias found" | `tsconfig.json` / `tsconfig.app.json` / `vite.config.ts` 三处 alias 没配齐 | 三处都要有 `@/*` → `./src/*` |
| `tsc` 报 `TS5101 baseUrl is deprecated` | TypeScript 6 弃用了 `baseUrl` | 只留 `paths`，不要 `baseUrl`（TS5+ 的 paths 相对 tsconfig 解析） |
| `tsc` 报 `TS1294 ... erasableSyntaxOnly` | 用了构造函数参数属性（`constructor(readonly x)`） | 模板开了 `erasableSyntaxOnly`，改成显式字段 + 赋值 |

## 排障时最有用的三样

1. **事件日志**（页面底部）：每一步的耗时、结果、trace_id，可一键复制整段。
2. **`trace_id`**：报障的唯一线索。后端刻意把详细原因只写日志。
3. **identity token 自检**（Privy 卡片里）：`iss` / `aud` / `sub` 三项全绿
   就意味着后端一定验得过 —— 把「后端为什么 400100」的排查整个提前到浏览器里。
