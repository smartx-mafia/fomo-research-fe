/**
 * 聪明钱身份详情 `GET /v1/smartmoney/detail`
 * （后端契约 docs/contracts/smartmoney-detail.md §6）。
 *
 * Optional 鉴权：公共数据，前端不传 bearer；带坏 token 会被 400000 拒绝，
 * 所以这里从签名上就不给 bearer 参数（与 auth.ts 登录端点同一红线）。
 * 返回身份、资料与 enabled；金额/时间约定同该文档 §0。
 */
import {call} from './envelope';

export type SmartMoneyDetailIdentity = {
  type?: string;
  user_id?: string;
  namespace?: string;
  address?: string;
};

export type SmartMoneyDetailProfile = {
  username?: string;
  display_name?: string;
  avatar_url?: string;
  tags?: string[];
  source_tags?: {code: string; logo_url: string}[];
  x_handle?: string;
};

export type SmartMoneyDetail = {
  identity?: SmartMoneyDetailIdentity;
  profile?: SmartMoneyDetailProfile;
  enabled?: boolean;
  follower_count?: number;
};

export type SmartMoneyDetailQuery =
  | {identity_type: 'wallet'; namespace: string; wallet_address: string}
  | {identity_type: 'user'; user_id: string};

export function smartMoneyDetailQueryKey(query: SmartMoneyDetailQuery) {
  return query.identity_type === 'wallet' ? `wallet:${query.namespace}:${query.wallet_address}` : `user:${query.user_id}`;
}

export async function getSmartMoneyDetail(query: SmartMoneyDetailQuery, signal?: AbortSignal) {
  const params = new URLSearchParams(query.identity_type === 'wallet'
    ? {identity_type: 'wallet', namespace: query.namespace, wallet_address: query.wallet_address}
    : {identity_type: 'user', user_id: query.user_id});
  return (await call<SmartMoneyDetail>(`/v1/smartmoney/detail?${params}`, {signal})).data;
}
