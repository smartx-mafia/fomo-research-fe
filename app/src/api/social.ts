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
