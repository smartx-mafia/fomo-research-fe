// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {cleanup, render, screen} from '@testing-library/react';
import {HolderRow} from './HolderListPanel';
import {normalizeHolder} from '@/api/token-holder-list';

const wallet = {type: 'wallet', namespace: 'solana', address: 'EVqxB3F6iUBeWsTpBFQqWwxpqUS8s4NrzgxBvQ2VRbTq'};
const subject = {type: 'external_user', id: 'subject:102'};
afterEach(cleanup);
describe('holder identity presentation', () => {
  for (const identity of [wallet, subject]) {
    it(`shows Jack and the actual wallet for ${identity.type}`, () => {
      const item = normalizeHolder({identity, profile: {display_name: 'Jack', avatar_url: 'https://static.smartx.io/jack.png', sources: ['FOMO']}, profile_subject: subject, wallets: [wallet], related_identities: [subject, wallet], position: {basis: 'external_snapshot', balance: '16512332.684995'}, viewer: {state: 'available', following: true, followed_subjects: [wallet]}});
      render(<HolderRow item={item} chain="solana" />);
      expect(screen.getByText('Jack')).toBeTruthy();
      expect(screen.getByText(wallet.address)).toBeTruthy();
      expect(screen.getByText(identity.type === 'wallet' ? 'Following' : 'Following wallet')).toBeTruthy();
      expect(document.querySelector('img')?.getAttribute('src')).toBe('https://static.smartx.io/jack.png');
      expect(screen.queryByRole('link', {name: 'Jack'})?.getAttribute('href')).toBe(identity.type === 'wallet' ? `/smart-money/solana/${wallet.address}` : undefined);
    });
  }
});
