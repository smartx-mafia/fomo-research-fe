/** 用户与聪明钱统一关注入口（docs/contracts/social.md §5）。 */
import {call} from './envelope';

export type SocialTargetType = 'user' | 'smart_money';

export type FollowMutationReply = {
  /** protojson 省略 false；读取时统一使用 !!following。 */
  following?: boolean;
  changed?: boolean;
  /** 仅关注聪明钱成功时可能出现。 */
  chains?: string[];
};

export type UserRelation = {
  identifier: string;
  following?: boolean;
  remark?: string;
};

export type SmartMoneyRelation = {
  address: string;
  following?: boolean;
  remark?: string;
  chains?: string[];
};

export type RelationsBatchReply = {
  users?: UserRelation[];
  smart_money?: SmartMoneyRelation[];
};

export function getRelations(
  bearer: string,
  targets: {userIdentifiers: string[]; addresses: string[]},
  signal?: AbortSignal,
) {
  return call<RelationsBatchReply>('/v1/social/relations/batch', {
    method: 'POST',
    bearer,
    signal,
    body: {
      ...(targets.userIdentifiers.length > 0 ? {user_identifiers: targets.userIdentifiers} : {}),
      ...(targets.addresses.length > 0 ? {addresses: targets.addresses} : {}),
    },
  });
}

export function followTarget(bearer: string, targetType: SocialTargetType, targetID: string) {
  return call<FollowMutationReply>('/v1/social/follows', {
    method: 'POST',
    bearer,
    body: {target_type: targetType, target_id: targetID},
  });
}

export function unfollowTarget(bearer: string, targetType: SocialTargetType, targetID: string) {
  return call<FollowMutationReply>('/v1/social/follows/delete', {
    method: 'POST',
    bearer,
    body: {target_type: targetType, target_id: targetID},
  });
}

// ── 推荐交易者与批量关注（social.md §5.4，Onboarding「Recommended Traders」） ──

export type RecommendedTrader = {
  /** 列表位次（1 起连续，剔除后重排），不是全站名次。 */
  rank: number;
  user: {
    identifier: string;
    /** 可为空串（未设置）—— 展示要有兜底。 */
    username?: string;
    nickname?: string;
    avatar_url?: string;
  };
  /** 7 天 PnL 的美元十进制字符串。**不要转 float 再显示**，按字符串直接格式化。 */
  pnl_usd: string;
  /** 首屏默认勾选（服务端规则，当前 = 前三）。不要自己写死前三。 */
  preselected?: boolean;
};

export type TimestampLike = {seconds?: number | string; nanos?: number};

export type RecommendedTradersReply = {
  /** 恒 "7d"（标签写「7D P&L」）。 */
  window?: string;
  /** 数据截止时间（榜每小时算一次）。全零对象 {seconds:0} = 榜不可用。 */
  as_of?: TimestampLike;
  /** 最多 10 行，按 rank 升序。空列表不是错误（三种来源同一形状）。 */
  traders?: RecommendedTrader[];
};

/**
 * GET /v1/social/recommended-traders —— 按 7 天 PnL 降序的交易者推荐榜。
 * 已剔除本人与已关注用户。**无副作用**：拉多少次都不会写关注。
 * 空列表不是错误：不足 10 人 / 已全部关注 / 榜不可用（as_of 全零）。
 */
export function getRecommendedTraders(bearer: string, signal?: AbortSignal) {
  return call<RecommendedTradersReply>('/v1/social/recommended-traders', {bearer, signal});
}

/** 批量关注逐目标结果。1=FOLLOWED（新建）2=ALREADY_FOLLOWING（幂等）3=NOT_FOUND 4=RESTRICTED。 */
export type FollowOutcome = 1 | 2 | 3 | 4;

export type FollowBatchReply = {
  /** 与请求同序、批内去重。空数组合法、回空 results（零关注继续时可以不调）。 */
  results?: {user_identifier: string; outcome?: FollowOutcome}[];
};

/**
 * POST /v1/social/follows/batch —— 一次关注一批**用户**（只收用户，
 * 聪明钱没有批量关注）。1～100 个。整批错误时一条边都不落，整批重发即可；
 * **失败重试不用记差集**：把同一份列表原样重发，已成功的回 2、其余再试一次。
 */
export function batchFollowUsers(bearer: string, userIdentifiers: string[]) {
  return call<FollowBatchReply>('/v1/social/follows/batch', {
    method: 'POST',
    bearer,
    body: {user_identifiers: userIdentifiers},
  });
}
