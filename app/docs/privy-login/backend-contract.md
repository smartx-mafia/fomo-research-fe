# 后端契约（前端视角）

> **权威源是后端仓的 `docs/contracts/user.md` 与 `api/business/v1/user.proto`。**
> 本文是 2026-08-28 的快照，冲突一律以后端仓为准。
>
> 已知不一致：`user.proto` 的注释写 `100100`，`docs/contracts/user.md` 的表写 `100107`
> （proto 注释陈旧）。**所以本地码表不能当穷举** —— 前端必须有 unknown 分支原样显示。

## 恒 200 信封

对外 HTTP **状态码恒为 200**，成败看 `body.code`（200 = 成功）。

```jsonc
// 成功
{"code":200,"msg":"success","data":{…},"trace_id":"…"}
// 失败
{"code":400100,"msg":"invalid or expired login credential",
 "error":"BIZ_IDENTITY_TOKEN_INVALID","action":{"type":"ACTION_TYPE_NONE"},"trace_id":"…"}
```

> **用 `res.ok` 判断成败会永远为真。** 这是这套契约最容易踩的坑。
> 本项目在 `src/api/envelope.ts` 里从结构上堵死了它：`call()` 不把 Response
> 交给调用方，`code !== 200` 一律抛 `ApiError`。

失败分三类，排查方向完全不同，UI 上颜色也不同：

| 类 | 判据 | 含义 |
|---|---|---|
| `business` | HTTP 200 且 `code !== 200` | 请求到了，是业务拒绝。看六位码 |
| `transport` | HTTP ≠ 200 | **没到信封层**。最常见是 404 = 后端是旧构建 |
| `network` | fetch 抛异常 | dev server 没起、代理不通，或写了绝对 URL 撞 CORS |

## POST /v1/auth/login —— 登录（=注册）

```jsonc
{
  "auth_channel": "AUTH_CHANNEL_PRIVY",   // v1 只接受这个
  "auth_method":  "AUTH_METHOD_EMAIL",    // EMAIL / GOOGLE / APPLE
  "identity_token": "<Privy identity token>"
}
```

成功 `data`：

```jsonc
{"token":"<本站 RS256 JWT>",
 "user":{"identifier":"1f95…","language":"en","created_at":1787826642},
 "is_new":true}
```

### 三条红线

1. **登录请求绝不带 `Authorization` 头。**
   该端点是 Optional 档：无头放行，但带了坏/过期 token 一律 `400000`，
   绝不降级成匿名。旧 token 过期后重登，头必须先摘掉。
   代码上 `login()` 的签名里根本没有 bearer 参数，让这件事无法发生。

2. **`auth_method` 必须与 identity token 的 `linked_accounts` 里真实存在的绑定一致**，
   否则 `100107`。它决定本站 JWT 的 `auth_type`（跨方式提权判定的依据），
   不能由客户端随口声称。映射：

   | Privy linked account type | auth_method |
   |---|---|
   | `email` | `AUTH_METHOD_EMAIL` |
   | `google_oauth` | `AUTH_METHOD_GOOGLE` |
   | `apple_oauth` | `AUTH_METHOD_APPLE` |

3. **`identity_token` 上限 8192 字节**，缺失或超长回 `100108`。

### 其它语义

- `is_new` 是「**本次调用创建了用户**」，不是「第一次见到这个人」——
  webhook 可能先建号，届时首登返回 `false`。
- **重复点击会被防重入拦下**（后端锁 TTL 10 秒），第二发回 `420102`。
  所以登录按钮在请求期间必须禁用。
- `created_at` 是**数字**（Unix 秒）。proto 注释说 protojson 会编成字符串 ——
  两种都要能吃，显示时统一 `Number()`。
- 零值字段**不出现**（`nickname` / `avatar_url` 未设置时可能是空串或缺席）。

## GET /v1/user/info

需要 `Authorization: Bearer <本站 JWT>`。回 `identifier` / `nickname` /
`avatar_url` / `language` / `created_at`。

## 六位码表

| code | error | 含义 / 动作 |
|---|---|---|
| 100107 | `BIZ_AUTH_METHOD_UNSUPPORTED` | 方式不支持，或与真实绑定不符 |
| 100108 | `BIZ_LOGIN_PARAM_INVALID` | identity_token 缺失/超长 |
| 400100 | `BIZ_IDENTITY_TOKEN_INVALID` | token 无效/过期，或 appId 与后端不是同一个 |
| 400101 | `BIZ_ACCOUNT_BANNED` | 封禁。**不要重试** |
| 400102 | `BIZ_ACCOUNT_DELETED` | 已注销。**不要重试** |
| 200102 | `BIZ_USER_NOT_FOUND` | JWT 合法但用户行不在，数据异常，报障 |
| 420102 | `BIZ_DUPLICATE_REQUEST` | 上一发还在处理，别并发重放 |
| 430104 | `BIZ_PRIVY_ACCOUNT_CONFLICT` | 账号冲突，服务端已告警。**不要重试** |
| 400000 | `SYS_UNAUTHENTICATED` | 未认证 |
| 420000 | `SYS_RATE_LIMITED` | 限流（IP 层 20 rps / burst 40）。退避 |
| 500097 | `SYS_UPSTREAM_UNAVAILABLE` | 该环境没配 Privy 或数据库 |

**排障请拿 `trace_id` 找后端查日志** —— 错误文案刻意笼统英文，
详细原因只进服务端日志（避免给探测者信号）。

## x-request-id

每个请求带一个**新生成**的 32 位小写 hex（`crypto.getRandomValues`，16 字节）。
回包的 `trace_id` 就是它。三条硬规则，违反的后果都是**静默失效**：

1. 每请求一个新的 —— 复用会把所有请求在后端日志里挤成一条链路，比不传更糟。
2. 不合法的值被后端**静默丢弃**（它另生成一个）。判断是否生效的唯一办法是
   比对回包 `trace_id` 与发出的值 —— 本项目在 ErrorPanel 里显式对比了。
3. 不要往 ID 里塞业务信息，它会进后端每一条日志行。

自己生成而不是等后端给，是为了在**请求根本没到后端时**也有 ID 可报。

## 本站 JWT

RS256，claims 是 `identifier` + `auth_type`（1=mail 2=wallet 3=google 4=apple），
**有效期 3 天**，**没有 refresh 机制** —— 过期只能重走一次完整登录。
