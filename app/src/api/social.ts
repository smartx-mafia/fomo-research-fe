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
  /** **对方有没有关注你**（2026-09-12）。与 following 是两件事；互关 = 两位都 true。 */
  followed_by?: boolean;
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

// ── 关注列表 / 推荐 / 备注 / 计数 / 关注者持仓（social.md §5 / §5.2 / §5.3 / §5.5） ──

/** 列表与批查里的用户公开资料片段：未设置的字段是空串，服务端不伪造。 */
export type SocialUserPublic = {
  identifier: string;
  username?: string;
  nickname?: string;
  avatar_url?: string;
};

/**
 * 展示名的回退顺序（social.md §5，服务端不代算，前端拼）：
 * `remark` → `nickname` → `username` → identifier 缩写（前 6…后 4）。
 * remark 与 nickname/username 要用不同样式区分（一个是「我起的」）。
 */
export function socialDisplayName(user: {
  remark?: string;
  nickname?: string;
  username?: string;
  identifier: string;
}): {primary: string; isRemark: boolean} {
  if (user.remark) return {primary: user.remark, isRemark: true};
  if (user.nickname) return {primary: user.nickname, isRemark: false};
  if (user.username) return {primary: `@${user.username}`, isRemark: false};
  return {primary: shortIdentifier(user.identifier), isRemark: false};
}

/** identifier / 地址缩写：前 6 + … + 后 4；过短原样。 */
export function shortIdentifier(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

/** 四个 follow 列表条目统一形态：按 target_type 二选一带一个结构体（social.md §5）。 */
export type FollowEntry = {
  /** 关注时刻（user 关注对方方向的时间）。 */
  followed_at?: TimestampLike;
  /** 恒有值：'user' | 'smart_money'。 */
  target_type: SocialTargetType;
  /** **你自己**给该目标设的备注原值；查他人的列表也只回你的备注。 */
  remark?: string;
  user?: SocialUserPublic;
  smart_money?: {
    /** 身份键只有地址不带链；名录里该地址收录且未拉黑的链，字典序；消失时缺席。 */
    address: string;
    chains?: string[];
  };
};

export type FollowListReply = {
  entries?: FollowEntry[];
  /** 空串 = 到底了。不透明串；损坏/过期/跨列表复用回 100103 → 丢弃重拉首屏。 */
  next_cursor?: string;
};

export type FollowListQuery = {userIdentifier?: string; cursor?: string; limit?: number};

function followListQuery(query: FollowListQuery): string {
  const params = new URLSearchParams();
  if (query.userIdentifier) params.set('user_identifier', query.userIdentifier);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * GET /v1/social/following —— 某用户正在关注的**混合列表**（用户 + 聪明钱），
 * 按关注时间统一排序。user_identifier 缺省 = 当前登录用户。
 * limit 硬上限 50，超限按 50 截断（不报错）。
 */
export function getFollowing(bearer: string, query: FollowListQuery = {}, signal?: AbortSignal) {
  return call<FollowListReply>(`/v1/social/following${followListQuery(query)}`, {bearer, signal});
}

/** GET /v1/social/followers —— 同形，方向相反；**恒为纯用户列表**（聪明钱不会关注人）。 */
export function getFollowers(bearer: string, query: FollowListQuery = {}, signal?: AbortSignal) {
  return call<FollowListReply>(`/v1/social/followers${followListQuery(query)}`, {bearer, signal});
}

/** GET /v1/social/mutual-follows —— 互相关注；恒为纯用户列表，cursor 独立分页类型。 */
export function getMutualFollows(bearer: string, query: FollowListQuery = {}, signal?: AbortSignal) {
  return call<FollowListReply>(`/v1/social/mutual-follows${followListQuery(query)}`, {bearer, signal});
}

export type FollowSuggestion = {
  user_identifier: string;
  /** 几位「我关注的人」也关注了 TA。JSON number。 */
  via_count?: number;
};

/**
 * GET /v1/social/follow-suggestions —— 推荐「可能认识的人」：我关注的人还关注了谁。
 * 已排除本人与已关注用户，按 via_count 降序。**一次拉取不分页**；
 * 结果可能少于 limit 甚至为空 —— 不是错误。
 */
export function getFollowSuggestions(bearer: string, limit?: number, signal?: AbortSignal) {
  const qs = limit !== undefined ? `?limit=${limit}` : '';
  return call<{suggestions?: FollowSuggestion[]}>(`/v1/social/follow-suggestions${qs}`, {bearer, signal});
}

export type KnownFollowersReply = {
  /** 条目里的 user_identifier 是**我关注的那个中间人**；followed_at 是我关注 TA 的时间。 */
  entries?: {user_identifier: string; followed_at?: TimestampLike}[];
  /**
   * 集合计数（拼「等 N 人」用），与翻页无关、每页都带。
   * **封顶 100**：拿到 100 应显示「100+」，不要当成正好一百。
   */
  total?: number;
};

/**
 * GET /v1/social/known-followers —— 目标用户的关注者中、我也关注的那部分
 * （资料页「A、B 等 N 人也关注了 TA」）。user_identifier **必填**（空回 100105；
 * 本人视角请用互关列表）。
 */
export function getKnownFollowers(
  bearer: string,
  userIdentifier: string,
  query: {cursor?: string; limit?: number} = {},
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({user_identifier: userIdentifier});
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  return call<KnownFollowersReply>(`/v1/social/known-followers?${params}`, {bearer, signal});
}

/**
 * POST /v1/social/remarks —— 给关注目标设置只有自己可见的备注名。
 * **备注与关注完全解耦**：可给未关注目标设备注；取消关注不清备注。
 * remark 1..64 字符（按字符计），空串 = 清除（逻辑删除，可再设）。
 * user 的 target_id 是 identifier；smart_money 的是地址（原样、不带链）。
 */
export function setRemark(bearer: string, targetType: SocialTargetType, targetId: string, remark: string) {
  return call<{remark?: string; changed?: boolean}>('/v1/social/remarks', {
    method: 'POST',
    bearer,
    body: {target_type: targetType, target_id: targetId, remark},
  });
}

export type RemarkEntry = {
  target_type: SocialTargetType;
  /** user = identifier；smart_money = 地址。 */
  target_id: string;
  remark: string;
  updated_at?: TimestampLike;
};

/** GET /v1/social/remarks —— 当前登录用户的全部备注，按 (target_type, target_id) 稳定序分页。 */
export function listRemarks(bearer: string, query: {cursor?: string; limit?: number} = {}, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const qs = params.toString();
  return call<{entries?: RemarkEntry[]; next_cursor?: string}>(`/v1/social/remarks${qs ? `?${qs}` : ''}`, {
    bearer,
    signal,
  });
}

/**
 * GET /v1/social/follow-counts —— 资料页头部的两个数字（social.md §5.5）。
 * user_identifier 缺省 = 当前登录用户。两字段恒出现，0 是合法答案。
 * 口径：只数状态正常的平台用户（聪明钱不计入）；实时计算，关注/取关后重拉即新值。
 */
export function getFollowCounts(bearer: string, userIdentifier?: string, signal?: AbortSignal) {
  const qs = userIdentifier ? `?user_identifier=${encodeURIComponent(userIdentifier)}` : '';
  return call<{following_count?: number; follower_count?: number}>(`/v1/social/follow-counts${qs}`, {
    bearer,
    signal,
  });
}

// ── 关注者持仓（social.md §5.3 + social-follow-holders.md）：「我关注的人里，谁持有这个币」──

export type FollowHolderItem = {
  user: SocialUserPublic;
  /** 标的最小单位十进制串；人类可读量 = shares / 10^decimals（decimals 在 token/info 里）。 */
  shares: string;
  /** 还持有的这些花了多少（USD）；空串 = 无法折算，**不是 0**。 */
  cost_usd?: string;
  /** 浮动盈亏 %；空串 = 行情不可得 / 成本为 0。 */
  pnl_percent?: string;
  /** 我给 TA 起的备注；无备注缺席。 */
  remark?: string;
};

export type TokenFollowHoldersReply = {
  /** 标准 TokenInfo；**缺席 = token-data 无记录**（不会回 decimals:0 的空壳）。 */
  token?: {chain: string; address: string; symbol?: string; name?: string; decimals?: number};
  items?: FollowHolderItem[];
  /** 持有者全量数，与分页无关。 */
  total?: number;
  next_cursor?: string;
};

/**
 * GET /v1/social/token-follow-holders —— 单币的 关注者持有人列表，
 * 按 (shares DESC, identifier ASC) 分页（默认 20、上限 100）。
 * chain 是链 slug（bsc/solana/base/robinhood/ethereum 小写，**不是**聪明钱面的 sol）。
 * 没关注任何人/都不持有 → 200 + 空 items，不是错误。上游未实现 500098 / 未配置 500097。
 */
export function getTokenFollowHolders(
  bearer: string,
  chain: string,
  address: string,
  query: {cursor?: string; limit?: number} = {},
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({chain, address});
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  return call<TokenFollowHoldersReply>(`/v1/social/token-follow-holders?${params}`, {bearer, signal});
}

export type TokenFollowHolderCount = {
  /** 回显请求键，恒有。 */
  token: {chain: string; address: string};
  /** 缺席 = 无记录 / 链不认识（此时 decimals 是 0，不要拿它换算金额）。 */
  info?: {chain: string; address: string; symbol?: string; name?: string; decimals?: number};
  /** 缺席 = 0。 */
  holder_count?: number;
  /** 按份额前 3 位预览（不含盈亏）。 */
  preview?: {user: SocialUserPublic; remark?: string}[];
};

/**
 * POST /v1/social/token-follow-holders/batch —— 多币的持有人数 + 前 3 位预览，
 * 供榜单/列表页角标。上限 100；回包与请求顺序一一对应；单项参数非法该项
 * holder_count 缺席而不是整请求失败。**不算盈亏**。
 */
export function batchTokenFollowHolderCounts(
  bearer: string,
  tokens: {chain: string; address: string}[],
) {
  return call<{items?: TokenFollowHolderCount[]}>('/v1/social/token-follow-holders/batch', {
    method: 'POST',
    bearer,
    body: {tokens},
  });
}
