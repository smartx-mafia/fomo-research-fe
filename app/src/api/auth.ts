import {call} from './envelope';

/** v1 只开这三种。其余枚举值后端一律回 100107。 */
export type AuthMethod = 'AUTH_METHOD_EMAIL' | 'AUTH_METHOD_GOOGLE' | 'AUTH_METHOD_APPLE';

export type UserInfo = {
  identifier: string;
  nickname?: string;
  avatar_url?: string;
  language?: string;
  /** Unix 秒。契约文档说是数字，但 protojson 有把 int64 编成字符串的先例，
   *  所以两种都要能吃 —— 显示时统一 Number()。 */
  created_at?: number | string;
  username?: string;
  privy_did?: string;
  /** Verified canonical login email returned by the backend; preferred for fiat receipt identity. */
  email?: string;
  bio?: string;
};

export type LoginReply = {
  token: string;
  user: UserInfo;
  is_new?: boolean;
};

/** 登录时随 identity token 一起带的准入凭据，两者至多带一个（invite.md §2.1）。 */
export type LoginCodes = {
  /** 邀请人的 8 位公开码（[a-z0-9]{8}，不收 @handle）。只在 probe 说 requires=1 或 430115/430116 后带。 */
  inviteCode?: string;
  /** 运营发的 16 位入场码（waitlist 本人认领）。只在 probe 说 requires=2 或 430117 后带。 */
  entryCode?: string;
};

/**
 * POST /v1/auth/login —— 登录（=注册）。
 *
 * **绝不传 bearer。** 登录端点是 Optional 档：无头放行，但带了坏/过期
 * token 一律 400000，绝不降级成匿名。旧 token 过期后重登，头必须先摘掉。
 * 这里从签名上就没有 bearer 参数，让「带错头」这件事无法发生。
 *
 * 按探针 / 错误码带上 `inviteCode` 或 `entryCode` 重调时**用同一个
 * identityToken**（还在 1 小时有效期内），不要重走 Privy。
 */
export function login(authMethod: AuthMethod, identityToken: string, codes: LoginCodes = {}) {
  const body: Record<string, string> = {
    auth_channel: 'AUTH_CHANNEL_PRIVY',
    auth_method: authMethod,
    identity_token: identityToken,
  };
  if (codes.inviteCode !== undefined) body.invite_code = codes.inviteCode;
  if (codes.entryCode !== undefined) body.entry_code = codes.entryCode;
  return call<LoginReply>('/v1/auth/login', {method: 'POST', body});
}

/** 注册阶段：`not_open` / `exclusive` / `protect` / `open`。窗口可被运营改，前端不得按时间自算。 */
export type AdmissionPhase = 'not_open' | 'exclusive' | 'protect' | 'open';

export type AuthProbeReply = {
  /** 这个 Privy 账号在本站已有用户行。false 时缺席。 */
  registered?: boolean;
  /** 还缺什么：1 需要邀请码 / 2 需要入场码。**0（不缺）时缺席**。 */
  requires?: 1 | 2;
  /** 当前阶段，恒存在。 */
  phase: AdmissionPhase;
};

/**
 * POST /v1/auth/probe —— 注册前探针（只读、无副作用，不建行、不计试码次数）。
 *
 * 与登录同档（Optional）：**不传 bearer**，带了坏 token 一律 400000。
 * identity token 无效回 400100，与登录同码。
 * 不要用 Privy SDK 的 isNewUser 替代它 —— 那是 Privy 侧的新旧。
 */
export function probeRegistration(identityToken: string) {
  return call<AuthProbeReply>('/v1/auth/probe', {method: 'POST', body: {identity_token: identityToken}});
}

/** GET /v1/user/info —— 需要本站 JWT。 */
export function getUserInfo(bearer: string) {
  return call<UserInfo>('/v1/user/info', {bearer});
}

/**
 * 探针：不带任何凭据打 /v1/user/info。
 *
 * 期望是**失败**（400000 / SYS_UNAUTHENTICATED）。拿到它就证明了三件事：
 * 浏览器直连通了、信封层活着、这个后端认得这条路由。所以调用方要把
 * "ApiError(business, 400000)" 当成**成功**来解读。
 */
export function probeUnauthenticated() {
  return call<UserInfo>('/v1/user/info');
}

/**
 * 探针：用一个必然无效的 identity_token 打登录端点。
 *
 * 期望 100108 或 400100（业务拒绝）。**若拿到 HTTP 404，说明这个后端是
 * 旧构建、根本没有 /v1/auth/login 路由** —— 这是区分新旧构建唯一的廉价
 * 办法，而本机 127.0.0.1:8080 当前正是这种情况。
 */
export function probeLoginRoute() {
  return login('AUTH_METHOD_EMAIL', 'x');
}
