# 端到端验收剧本

四层，从不需要浏览器到需要数据库，每层失败都能独立定位。
边跑边填「实际」列。

## L0 · 静态

| # | 动作 | 期望 | 实际 |
|---|---|---|---|
| 0.1 | `npx tsc -b --noEmit` | 无输出 | ☐ |
| 0.2 | `npm run build` | `✓ built in …` | ☐ |

## L1 · 后端可达性（不碰 Privy）

页面上点「0 · 后端自检」，或用 curl：

```bash
curl -s http://localhost:7500/v1/ping
curl -s http://localhost:7500/v1/user/info
curl -s -X POST http://localhost:7500/v1/auth/login -H 'content-type: application/json' \
  -d '{"auth_channel":"AUTH_CHANNEL_PRIVY","auth_method":"AUTH_METHOD_EMAIL","identity_token":"x"}'
```

| # | 动作 | 期望 | 实际 |
|---|---|---|---|
| 1.1 | `/v1/ping` 经代理 | `code:200`，`service:"business"` | ☐ |
| 1.2 | 探针1 匿名 `/v1/user/info` | `400000` / `SYS_UNAUTHENTICATED`（**失败才是通过**） | ☐ |
| 1.3 | 探针2 假 token 打登录 | `400100` 或 `100108`。**拿到 HTTP 404 = 后端是旧构建** | ☐ |
| 1.4 | 自带 `x-request-id` 时回包 `trace_id` 与之相同 | 一致（不一致 = 我们的 ID 被判非法丢弃了） | ☐ |

## L2 · Privy 侧（浏览器里就能判死）

| # | 动作 | 期望 | 实际 |
|---|---|---|---|
| 2.1 | 填邮箱 → 发送验证码 | 收到邮件；流程状态变 `awaiting-code-input` | ☐ |
| 2.2 | 输码 → 登录 | 流程状态 `done`，Privy 卡片变「已登录」 | ☐ |
| 2.3 | 「绑定」列表 | 出现 `email` | ☐ |
| 2.4 | identity token 自检三项 | `iss=privy.io` ✓、`aud=cmt77j1bz00870cjorav46hyb` ✓、`sub` 以 `did:privy:` 开头 ✓ | ☐ |

> **2.4 是最有价值的一格**：三项对上就意味着后端一定验得过
>（后端验签公钥已确认与 Privy 逐字节一致）。

## L3 · 换取与验证

| # | 动作 | 期望 | 实际 |
|---|---|---|---|
| 3.1 | 「以 EMAIL 登录」 | `code:200`，记下 `identifier` / `is_new:true` / `trace_id` | ☐ |
| 3.2 | 「验证：GET /v1/user/info」 | `code:200`，且页面标出「✓ identifier 与登录返回的一致」 | ☐ |
| 3.3 | **不清 Privy，再点一次「以 EMAIL 登录」** | `code:200` 且 **`is_new:false`**，`identifier` **与 3.1 完全相同** | ☐ |
| 3.4 | 「清除本站 token」→ 再点「验证」 | 本站卡片回到「未换取」；Privy 卡片**仍是已登录** | ☐ |
| 3.5 | 「全部退出并清空」→ 重新完整登一遍 | `identifier` 仍与 3.1 相同 | ☐ |
| 3.6 | 复制本站 JWT，贴进 curl | `curl -s http://localhost:7500/v1/user/info -H "authorization: Bearer <JWT>"` 回 `code:200` | ☐ |
| 3.7 | 手工把 localStorage 的 `smartx-login-fe.jwt` 改坏 → 点「验证」 | 显示 `400000` + `SYS_UNAUTHENTICATED` + trace_id，**不是白屏也不是成功** | ☐ |

> **3.3 和 3.5 比「登录成功」重要得多。** 它们验的是「按 DID 归位」而不是每次
> 新建用户 —— 重复建号在测试期完全看不出来（每次都成功），上线后是灾难。

## L4 · 落库（决定性一步）

数据库当前是干净基线（`app.users` / `user_auth` / `user_account` 均 0 行）。

```bash
PGPASSWORD='<见后端仓 configs/business.yaml 的 data.database.source>' \
psql -h 13.231.246.26 -U ssmg -d smartx_core \
  -c "SELECT identifier, privy_did, status, created_at FROM app.users ORDER BY id DESC LIMIT 5;" \
  -c "SELECT identifier, auth_type, auth_channel, auth_key FROM app.user_auth ORDER BY id DESC LIMIT 5;" \
  -c "SELECT count(*) FROM app.user_account;"
```

| # | 断言 | 期望 | 实际 |
|---|---|---|---|
| 4.1 | `app.users` 行数 | 首登后 0 → **1** | ☐ |
| 4.2 | `users.identifier` | **与页面显示的完全一致**（把浏览器和数据库钉死的唯一一步） | ☐ |
| 4.3 | `users.privy_did` | 等于 Privy 卡片上的 DID；`status=1` | ☐ |
| 4.4 | `app.user_auth` | 1 行，`auth_type=1`(mail)、`auth_channel=2`(privy)、`auth_key`= 小写邮箱 | ☐ |
| 4.5 | **第二次登录后** | `users` 仍 **1** 行、`user_auth` 仍 **1** 行 —— 证明按 DID 归位而非重复建号 | ☐ |
| 4.6 | `app.user_account` | **0 行**（该 app `create_on_login: off`）。有行反而要追 | ☐ |
| 4.7 | 拿页面上的 `trace_id` 去后端日志 grep | 能捞到那一条 | ☐ |

> `app.user_audit_log` 是**异步写**的（提交后 goroutine），进程崩溃时会丢。
> 查不到不一定是 bug。
