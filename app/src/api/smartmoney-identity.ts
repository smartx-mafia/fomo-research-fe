import {call} from './envelope';
import {isExternalSubjectId} from '@/lib/smartmoney-identity';

export type SmartMoneyIdentityDetail = {
  identity: {type: 'user' | 'wallet'; user_id?: string; namespace?: 'evm' | 'solana'; address?: string; user_type: number};
  profile: {username?: string; display_name?: string; avatar_url?: string; x_handle?: string; tags?: string[]; source_tags?: {code: string; logo_url?: string}[]};
  enabled: boolean;
  follower_count: number;
};

export function getSmartMoneyIdentityDetail(identity: {subjectId: string} | {namespace: 'evm' | 'solana'; walletAddress: string}, bearer?: string, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if ('subjectId' in identity) {
    if (!isExternalSubjectId(identity.subjectId)) throw new Error('Invalid external subject id.');
    params.set('identity_type', 'user');
    params.set('user_id', identity.subjectId);
  } else {
    if (!identity.walletAddress) throw new Error('Wallet address is required.');
    params.set('identity_type', 'wallet');
    params.set('namespace', identity.namespace);
    params.set('wallet_address', identity.walletAddress);
  }
  return call<SmartMoneyIdentityDetail>(`/v1/smartmoney/detail?${params.toString()}`, {bearer, signal});
}
