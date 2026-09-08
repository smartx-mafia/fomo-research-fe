/**
 * X（Twitter）账号绑定的接口层。契约见后端仓 `docs/contracts/x-import.md`
 * 与 `api/business/v1/ximport.proto`。
 *
 * 这套回包有两处与 /v1/auth/* 不同、而且**照 proto 手推一定会错**，
 * 所以在类型上就写成「可缺席」，让编译器逼着调用方处理：
 *
 * ① **零值字段整个缺席**（Go 标准库 JSON 的 omitempty）：`count` 为 0、
 *    `truncated` 为 false、`synced_at` 为空时，这些 key 根本不出现。于是
 *    「这个人没关注任何人」必须写 `status === 2 && !count` ——
 *    写 `count === 0` 拿到的是 `undefined`，判断恒为 false，界面会一直显示
 *    「导入 undefined 条」而不报任何错。
 * ② **枚举编成数字不是名字**：`follow_import.status` 是 1/2/3/4。
 *    把它当字符串比（`=== 'PENDING'`）同样不报错，只是永远不成立 ——
 *    症状是进度条永远停在初始态，没人会往「枚举编码」上想。
 *
 * 四个端点**全部要求本站 JWT**（Required 档，绑定改的是"我的"账号关联，
 * 身份只取自 JWT）。所以 `bearer` 是每个函数的**第一个必填参数** ——
 * 从签名上让「忘了带 token」编译不过，而不是运行时回 400000。
 */
import {call} from './envelope';

/** 关注导入进度。**是数字不是名字**，见本文件头 ②。 */
export const FOLLOW_IMPORT = {
  /** 待同步 / 同步中，可继续轮询（典型 30 秒内开始）。 */
  PENDING: 1,
  /** 已完成。`count` 缺席（=0）表示这个人**确实没关注任何人**。 */
  SYNCED: 2,
  /** 多次尝试后失败，不会再自动重试；解绑后重绑可再试一次。 */
  FAILED: 3,
  /** 对方是受保护账号，抓取通道拿不到关注列表。 */
  PROTECTED: 4,
} as const;

export type FollowImportStatus = (typeof FOLLOW_IMPORT)[keyof typeof FOLLOW_IMPORT];

/**
 * SYNCED + count 缺席（"没有关注任何人"）与 PROTECTED（"拿不到"）是两回事，
 * 界面上必须分得开 —— 混成一句"0 个关注"会让受保护账号看起来像导入成功了。
 */
export const FOLLOW_IMPORT_LABEL: Record<FollowImportStatus, string> = {
  1: '导入中',
  2: '已完成',
  3: '导入失败',
  4: '账号受保护',
};

export type XProfile = {
  /** X 的数字用户 id（字符串形态），**永不变**。做关联一律用它。 */
  x_user_id: string;
  /** handle（不含 @）。用户随时能改，只用于展示与跳转，别拿它做关联。 */
  username?: string;
  display_name?: string;
  /** 48×48 小图。用户换头像后旧链接 404，**渲染时必须兜 onError**。 */
  avatar_url?: string;
  description?: string;
  verified?: boolean;
  followers_count?: number;
  following_count?: number;
};

export type XFollowImport = {
  status?: FollowImportStatus;
  /** 已导入条数。**为 0 时整个缺席**，判空只能用 `!count`。 */
  count?: number;
  /** RFC3339。未完成时缺席。 */
  synced_at?: string;
  /** true 表示关注数超上限被截断，此时 `count` 是上限值而非真实关注数。false 时缺席。 */
  truncated?: boolean;
};

export type XBinding = {
  /** 成功回包里恒为 true —— 没绑定时后端回的是 200106 而不是 `bound:false`。 */
  bound?: boolean;
  profile?: XProfile;
  follow_import?: XFollowImport;
};

export type XBindStartReply = {
  authorize_url: string;
  /** 与 authorize_url 内一致的一次性 state，回调时**原样回传**。 */
  state: string;
};

/**
 * 这个域用得到的六位码。写成常量而不是散落的字面量，是因为其中三个
 * （200106 / 400103 / 100117）**不是"报错"而是流程分支**，判错一个
 * 就会把正常状态渲染成红色故障，或者把"要重新发起"渲染成"重试即可"。
 */
export const X_CODE = {
  /** 请求体里的 code/state 缺失或格式非法。 */
  paramInvalid: 100116,
  /** 授权码已被 X 用过或已过期 —— **重新从第 ① 步发起**，重试本请求无用。 */
  codeInvalid: 100117,
  /** 没有生效的 X 绑定。**这是正常状态，不是错误。** */
  bindingNotFound: 200106,
  /** state 无效/过期/不属于当前用户 —— 重新从第 ① 步发起。 */
  stateMismatch: 400103,
  /** 近 24 小时绑定次数达上限（滚动窗口）。**不要自动重试。** */
  bindRateLimited: 420103,
  /** 当前用户已绑定，先解绑。 */
  alreadyBound: 430108,
  /** 该 X 账号已被他人绑定。**不要自动重试。** */
  accountTaken: 430109,
  /** 上游未配置或不可用；metadata.upstream 区分是 x 还是 database。 */
  upstreamUnavailable: 500097,
  /** X 上游故障，可稍后重试。 */
  upstreamFailure: 500105,
} as const;

/**
 * POST /v1/user/x/bind/start —— 发起绑定。
 *
 * **本端点不外呼 X、不产生费用，可以安全重试**（换 token 那步才花钱）。
 * 已绑定时回 430108。下发的 `state` 有效期 10 分钟。
 */
export function startXBind(bearer: string) {
  return call<XBindStartReply>('/v1/user/x/bind/start', {method: 'POST', body: {}, bearer});
}

/**
 * POST /v1/user/x/bind —— 用回调带回的 code 完成绑定。
 *
 * `state` 必须原样回传、**不得改写也不得复用**：它在第一次提交时就被消费，
 * 同一份 {code,state} 再提交回 400103（不是 100117）。
 */
export function completeXBind(bearer: string, code: string, state: string) {
  return call<XBinding>('/v1/user/x/bind', {method: 'POST', body: {code, state}, bearer});
}

/** GET /v1/user/x/binding —— 查绑定与导入进度。**无绑定时回 200106，不是空数据。** */
export function getXBinding(bearer: string) {
  return call<XBinding>('/v1/user/x/binding', {bearer});
}

/** POST /v1/user/x/unbind —— 逻辑删除。成功回 `data: {}`，之后查询回 200106。 */
export function unbindX(bearer: string) {
  return call<Record<string, never>>('/v1/user/x/unbind', {method: 'POST', body: {}, bearer});
}

/** 一行日志用的摘要。**故意把"缺席"显式打出来** —— 那正是这套回包最容易误判的地方。 */
export function describeBinding(b: XBinding): string {
  const fi = b.follow_import;
  return [
    b.profile?.username ? `@${b.profile.username}` : '(username 缺席)',
    b.profile?.x_user_id ? `x_user_id=${b.profile.x_user_id}` : '(x_user_id 缺席)',
    fi
      ? `status=${fi.status ?? '(缺席)'} count=${fi.count ?? '(缺席=0)'}` +
        `${fi.truncated ? ' truncated' : ''}`
      : 'follow_import 缺席',
  ].join(' ');
}
