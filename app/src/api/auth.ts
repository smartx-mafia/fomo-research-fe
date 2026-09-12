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
  /**
   * 「本次调用建了行」（含 waitlist 认领），**不等于「首次登录」** —— Privy 的
   * webhook 可能抢先建号。2026-09-11 起只剩埋点用途：引导看
   * GET /v1/user/onboarding，准入看 GET /v1/invite/status，都不要用它判断。
   */
  is_new?: boolean;
};

/**
 * POST /v1/auth/login —— 登录（=注册）。
 *
 * **绝不传 bearer。** 登录端点对无头请求放行，但带了坏/过期 token 一律
 * 400000，绝不降级成匿名。旧 token 过期后重登，头必须先摘掉。这里从签名上
 * 就没有 bearer 参数，让「带错头」这件事无法发生。
 *
 * 请求体只有三个字段（user.md §1）：`invite_code` / `entry_code` 已于
 * 2026-09-11 删除（服务端静默丢弃），登录**不会因为邀请域的任何理由失败** ——
 * 独占期里名单外的人照样建号拿 JWT。绑定上级与准入判定都在登录之后：
 * GET /v1/invite/status 按 `next_action` 分支（invite.md §2.2）。
 */
export function login(authMethod: AuthMethod, identityToken: string) {
  return call<LoginReply>('/v1/auth/login', {
    method: 'POST',
    body: {
      auth_channel: 'AUTH_CHANNEL_PRIVY',
      auth_method: authMethod,
      identity_token: identityToken,
    },
  });
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
