/** 用户与聪明钱统一关注入口（docs/contracts/social.md §5）。 */
import {call} from './envelope';

export type SocialTargetType = 'user' | 'smart_money';
export type SmartMoneyIdentity =
  | {type: 'user'; user_id: string}
  | {type: 'wallet'; namespace: string; address: string};
export type RemarkTarget =
  | {target_type: 'user'; target_id: string}
  | {target_type: 'smart_money'; identity: SmartMoneyIdentity};

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
  identities?: {identity: SmartMoneyIdentity; following?: boolean; remark?: string}[];
};

export function getRelations(
  bearer: string,
  targets: {userIdentifiers: string[]; addresses: string[]; identities?: SmartMoneyIdentity[]},
  signal?: AbortSignal,
) {
  return call<RelationsBatchReply>('/v1/social/relations/batch', {
    method: 'POST',
    bearer,
    signal,
    body: {
      ...(targets.userIdentifiers.length > 0 ? {user_identifiers: targets.userIdentifiers} : {}),
      ...(targets.addresses.length > 0 ? {addresses: targets.addresses} : {}),
      ...(targets.identities?.length ? {identities: targets.identities} : {}),
    },
  });
}

export function setRemark(bearer: string, target: RemarkTarget, remark: string) {
  return call<{remark?: string; changed?: boolean}>('/v1/social/remarks', {
    method: 'POST', bearer, body: {...target, remark},
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
