import {leaderboardIdentityKey, type LeaderboardIdentity} from '@/api/leaderboard-new';
import {getRelations, type RemarkTarget, type SmartMoneyIdentity} from '@/api/social';

export function leaderboardRemarkTarget(identity: LeaderboardIdentity): RemarkTarget {
  if (identity.type === 'smartx_user') return {target_type: 'user', target_id: identity.id};
  return {target_type: 'smart_money', identity: identity.type === 'wallet'
    ? {type: 'wallet', namespace: identity.namespace, address: identity.address}
    : {type: 'user', user_id: identity.id}};
}

export async function getLeaderboardRemarks(bearer: string, identities: LeaderboardIdentity[]) {
  const remarks: Record<string, string> = {};
  // 每桶最多 100 个；按请求下标对应返回值，不依赖服务端归一化后的身份键。
  for (let offset = 0; offset < identities.length; offset += 100) {
    const users: LeaderboardIdentity[] = [];
    const external: LeaderboardIdentity[] = [];
    const targets: SmartMoneyIdentity[] = [];
    for (const identity of identities.slice(offset, offset + 100)) {
      const target = leaderboardRemarkTarget(identity);
      if (target.target_type === 'user') users.push(identity);
      else {external.push(identity); targets.push(target.identity);}
    }
    const {data} = await getRelations(bearer, {
      userIdentifiers: users.map((identity) => identity.id!), addresses: [], identities: targets,
    });
    users.forEach((identity, index) => {remarks[leaderboardIdentityKey(identity)] = data.users?.[index]?.remark ?? '';});
    external.forEach((identity, index) => {remarks[leaderboardIdentityKey(identity)] = data.identities?.[index]?.remark ?? '';});
  }
  return remarks;
}
