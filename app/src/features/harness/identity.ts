// 身份链的判定层。**只有纯函数，没有 I/O** —— React 那侧只负责按结果分支。
//
// # 这条链长什么样
//
//     邮箱验证码 / Google / Apple 登录（headless）
//       → Privy 会话；**钱包要显式建**（headless 登录不触发自动创建）
//       → getIdentityToken() 拿 identity token
//       → POST /v1/auth/login  → 本站 JWT + identifier
//       → 就绪
//
// # 这里从前还有第四步，2026-09-03 删了
//
// 从前登录之后还要 `linkWithCustomJwt`，把一个 custom_auth 账号挂到同一个
// Privy 用户上，而且这个模块用 `needsCustomAuthLink` 判定挂没挂上、没挂上
// 就硬停。那一步**基于一个已经不成立的前提**。
//
// 当时的理由是：business 查钱包走 `POST /users/custom_auth/id`，按
// `custom_user_id = 我们的 identifier` 查 —— 于是不 link 就查无此人。
//
// 后端已经不那么查了。`privysecurity/client.go` 现在走的是
// **`GET /users/<privy_did>`**：登录时验过 Privy identity token，把
// `(identifier, privy_did)` 原子落进 `app.users`，查钱包时先按 identifier
// 读这条**本地已验签的映射**，再用 DID 去问 Privy。那个文件的注释写得很直白：
//
//     这里不能再要求 `custom_user_id = identifier`。custom_user_id 只有前端
//     另走 Privy Custom Auth 时才存在，而标准邮箱/社交登录只保证 DID。
//
// 改动是 `6751d44 fix(business): resolve Privy wallets by stored DID`，
// 2026-09-03 部署到 smartx-test；来龙去脉在后端仓的
// `docs/research/2026-09-03-privy-credentials-without-jwt-auth.md`（方案 B）。
//
// **删掉它不只是清理，是解掉一个死锁。** `linkWithCustomJwt` 要求 Privy 那侧
// 开着 JWT-based auth，而两个 app 的 `custom_jwt_auth` 都是 `false`（拿公开的
// `GET https://auth.privy.io/api/v1/apps/<appId>` 查得到），于是那一步**当场
// 401，永远不可能成功** —— 而这个模块的处置是硬停。结果是：一条后端根本不
// 需要的步骤，把整个下单按钮永久锁死了。
//
// 那份研究文档还点出了一处更早的误诊，值得留着：本文件从前把成因写成
// 「登录建出来的 Privy 用户身上只有 email 那条 linked account」，听起来像
// "多挂一条就好了"；而真正的成因更靠前 —— 那个端点在 **app 级别**就 401，
// 挂不挂得上根本轮不到用户这一层。

/** 就绪判定的输入。每一项都是"这一步做完了没有"。 */
export type ReadinessInput = {
  /** Privy SDK 初始化完毕。 */
  ready: boolean;
  /** Privy 会话已建立。 */
  authenticated: boolean;
  /** 本站 JWT 已拿到。 */
  hasToken: boolean;
  /** 目标链的 embedded 钱包已经出现在 useWallets() 里。 */
  hasWallet: boolean;
};

export type Readiness = {
  ready: boolean;
  /** 没就绪时卡在哪一步。就绪时是空串。 */
  blocker: string;
};

/**
 * 下单按钮可不可点。
 *
 * **返回卡在哪一步而不是只回一个布尔**：一个禁用的按钮不说明任何事，
 * 而这条链有四步，猜是哪一步的成本很高。
 *
 * `hasToken` 这一格不能省 —— 少了它的后果是点下去回 401，而那个码说的是
 * "未认证"，看起来像登录本身出了问题。
 */
export function readiness(s: ReadinessInput): Readiness {
  if (!s.ready) return {ready: false, blocker: 'Privy SDK 还在初始化'};
  if (!s.authenticated) {
    return {ready: false, blocker: '还没登录 —— 点顶栏那枚「登录」芯片，填邮箱、收验证码'};
  }
  if (!s.hasToken) return {ready: false, blocker: '还没换到本站 token（/v1/auth/login）'};
  // **不要写成"等一会儿"。** headless 登录不触发自动建钱包（见 App.tsx 的
  // doCreateWallets），等多久都不会有 —— 那句话会让人白等，然后判成页面坏了。
  if (!s.hasWallet) {
    return {ready: false, blocker: 'embedded 钱包还没建好 —— 不会自动建，去顶栏「个人信息」里点「创建 embedded 钱包」'};
  }
  return {ready: true, blocker: ''};
}
