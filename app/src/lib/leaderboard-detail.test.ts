import {expect, it} from 'vitest';
import type {UnifiedLeaderboardEntry} from '@/api/leaderboard-new';
import {leaderboardDetailHref, parseLeaderboardDetail} from './leaderboard-detail';

const entry = {identity: {type: 'external_user', id: 'subject:3'}, platforms: ['PUMP', 'FOMO'], chains: ['sol', 'base']} as UnifiedLeaderboardEntry;
it('preserves opaque external IDs and chooses FOMO for a merged platform identity', () => {
  const href = leaderboardDetailHref(entry)!;
  expect(href).toContain('id=subject%3A3');
  expect(parseLeaderboardDetail(new URL(href, 'https://example.test').searchParams)).toEqual({type: 'external_user', id: 'subject:3', platform: 'fomo'});
  expect(leaderboardDetailHref({...entry, platforms: ['PUMP']})).toContain('platform=pump');
});
it('keeps all wallet chains and the original address for a reloadable link', () => {
  const identity = {type: 'wallet', namespace: 'evm', address: '0xAbC'} as const;
  const href = leaderboardDetailHref({...entry, identity, chains: ['base', 'bsc']})!;
  expect(parseLeaderboardDetail(new URL(href, 'https://example.test').searchParams)).toEqual({...identity, chains: ['base', 'bsc']});
});
it('routes SmartX by identifier and rejects incomplete or unsupported links', () => {
  const href = leaderboardDetailHref({...entry, identity: {type: 'smartx_user', id: 'user:42'}})!;
  expect(parseLeaderboardDetail(new URL(href, 'https://example.test').searchParams)).toEqual({type: 'smartx_user', id: 'user:42'});
  expect(parseLeaderboardDetail(new URLSearchParams('type=wallet&address=abc&namespace=evm&chain=all'))).toBeNull();
  expect(parseLeaderboardDetail(new URLSearchParams('type=external_user&id=subject:3&platform=gmgn'))).toBeNull();
});
