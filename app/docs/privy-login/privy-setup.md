# Privy 接入说明

## 当前这个 app（2026-08-31 起换用新 app）

2026-08-31 后端 `configs/business.yaml` 把 `privy.app_id` 换成了新 app，
前端 `.env.local` / `.env.example` 已同步。

| 项 | 值 |
|---|---|
| appId | `cmt77j1bz00870cjorav46hyb` |
| clientId | 留空 —— 旧 app 的 `client-WY6d…` 已作废；新 app 若建了 client，去 Dashboard → Clients 取新值填 `.env.local` |

下面这些控制台开关是**旧 app（"gege"，2026-08-28）的实测值**，新 app 尚未逐项复核
（复核清单见 `docs/verification.md`）：

| 项 | 旧 app 实测值（新 app 待复核） |
|---|---|
| `email_auth` | true —— 邮箱验证码可用 |
| `google_oauth` | false —— 控制台没开 |
| `apple_oauth` | false —— 控制台没开 |
| `custom_jwt_auth` | false（与后端仓那个签名 harness 的用法互不干扰） |
| `allowed_domains` | `[]`（不限制，`localhost:7500` 可用） |
| `embedded_wallet_config.create_on_login` | `off` —— **不会自动建钱包**（若新 app 是 on，先读文末 StrictMode 一节再说） |

换 app 后**必须重新核验**的两件事（旧 app 上验过的结论不迁移）：

- 后端 `verification_key` 是否已换成**新 app** 的公钥，且与 Privy 返回的逐字节一致
  （取值：控制台 API keys 区「Verify with key instead」，或公开的
  `https://auth.privy.io/api/v1/apps/<appId>/jwks.json`）。
- 控制台是否开了「Return user data in an identity token」（默认**关**，见下文 ——
  关着时 Privy 登录一切正常，唯独换取一步拿不到 identity token）。

## appId / clientId 不是凭据

它们会出现在每个访问者的网络面板里，所以可以入库到 `.env.example`。
**`app_secret` 绝不出现在前端** —— 它只在后端的 `configs/business.secret.yaml` 里。

`appId` 必须与后端 `privy.app_id` **逐字符一致**：它是 identity token 的
`aud` 校验值，对不上时登录一律 `400100`。

`clientId` 是可选的。**留空要真的留空** —— 空串会被 `PrivyProvider` 当成一个
真实存在的 client id 去校验然后失败，所以 `config.ts` 里用 `|| undefined`。

## identity token ≠ access token

**后端要的是 identity token。** 两者都是 ES256 JWT、`iss=privy.io`、`aud`= app id、
`sub`= `did:privy:…`、约 1 小时有效，但：

| | access token | identity token |
|---|---|---|
| 拿法 | `usePrivy().getAccessToken()` | `useIdentityToken()` / `getIdentityToken()` |
| cookie | `privy-token` | `privy-id-token` |
| 独有 claims | `sid` | **`linked_accounts`**（字符串化的 JSON 数组） |
| 刷新 | SDK 自动 | **不自动** |

后端要 `linked_accounts` 来判定 `auth_method` 是否属实，所以只能用 identity token。

### 控制台必须先打开 identity token（默认是**关**的）

Dashboard → **User management → Authentication → Advanced** →
打开 **「Return user data in an identity token」**。

关着的时候，Privy 一切正常：能收验证码、能登录、`privy:token`（access token）
照发、`GET /api/v1/users/me` 回 `200` —— 唯独回包里 `identity_token` 是 `null`。
SDK 拿到 `null` 会**清掉**本地的 `privy:id_token`，于是 `getIdentityToken()`
返回 `null`，页面报「identity token 取不到」。

所以「Privy 登录成功」与「拿得到 identity token」是**两件事**，
排查时别把前者当成后者的证据。一条命令就能判：

```bash
curl -s https://auth.privy.io/api/v1/users/me \
  -H "authorization: Bearer <privy access token>" \
  -H "privy-app-id: <appId>" | jq .identity_token
# null → 控制台没开；一串 JWT → 开了
```

### 换取时必须现取，不能用 hook 快照

```ts
// ✗ 错：useIdentityToken() 给的是上一次渲染时的快照
const {identityToken} = useIdentityToken();
await login(method, identityToken);

// ✓ 对：命令式现取
const idt = await getIdentityToken();
await login(method, idt);
```

用户填完验证码、去泡杯咖啡回来再点「换取」，闭包里那个串可能已经过期 ——
后端回 `400100`，而在场所有人都会去怀疑后端验签、去比对公钥（**而公钥是对的**）。
本项目里 `useIdentityToken()` 只用于**显示**剩余时效。

## 怎么开 Google / Apple

前端代码**已经接好了**（`useLoginWithOAuth().initOAuth({provider})` +
回跳收尾 + 对应的 `AUTH_METHOD_*`）。两道闸都要开：

1. **Privy 控制台**：Dashboard → app `cmt77j1bz00870cjorav46hyb` → Login methods
   → Socials → 打开 Google / Apple → 保存。
   （Privy 自带默认 OAuth 凭据，**不需要**自己申请 Google client。）
2. **本地硬闸**：`.env.local` 里 `VITE_ENABLE_GOOGLE=true` / `VITE_ENABLE_APPLE=true`，
   然后**重启 dev server**。

两道都开后刷新页面即可用，不用改代码。

> **为什么默认按「关」渲染，探测失败也按关**：默认开的代价是用户点下去跳到
> 一个 Privy 的报错页，回来后整页 state 全丢 —— 那个症状看起来完全像是本页坏了。

### Apple 自带凭据的坑（将来要用才看）

Apple 用 **Services ID** 作 Client ID，另需 Key ID + 私钥全文。
且官方明说：**已用 Privy 默认凭据登录过的用户，迁移到自有凭据不受支持** ——
要用自有凭据必须新建 app 并在任何 Apple 用户登录之前设好。

### OAuth 是整页重定向

三个后果，代码里都处理了：

1. 回跳后组件必须挂载着才收得了尾 → `useLoginWithOAuth()` 的接线**常驻在 `App` 层**，
   不能放进按条件渲染的子组件里。放错的症状是：跳出去、跳回来、什么都没发生。
2. 重定向清空所有 React state → 跳走前把 provider 写进 `sessionStorage`，回来续上日志。
3. 回跳后 `history.replaceState` 洗掉 URL 上的回调参数 —— 留着的话刷新会重放一次登录，
   症状是「我明明退了，刷新又登进去了」。

## 为什么不用 React.StrictMode

StrictMode 在开发模式下故意把 effect 跑两遍。而 Privy 的 `createOnLogin` 正好是
一个不幂等的副作用 —— 跑两遍就**建两只钱包**（后端仓 2026-08-28 实测撞到，
两只的 `first_verified_at` 相差 1 秒）。**代价是永久的：Privy 的钱包删不掉。**

本 app 的 `create_on_login` 当前是 `off`，眼下不会建钱包 —— 但一旦哪天在
dashboard 里打开，这个错误会立刻发生且无法回收。所以保持与后端仓
`web/embedded-harness` 一致：不开 StrictMode。
