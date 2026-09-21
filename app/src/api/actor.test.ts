import {describe, expect, it} from 'vitest';
import {normalizeActor} from './actor';

export const jackWallet = {type: 'wallet', namespace: 'solana', address: 'EVqxB3F6iUBeWsTpBFQqWwxpqUS8s4NrzgxBvQ2VRbTq'};
export const jackSubject = {type: 'external_user', id: 'subject:102'};
export const jackActor = {
  identity: jackWallet,
  profile: {display_name: 'Jack', username: 'Jack', avatar_url: 'https://static.smartx.io/jack.png', sources: ['FOMO']},
  profile_subject: jackSubject, wallets: [jackWallet], related_identities: [jackWallet, jackSubject],
  viewer: {state: 'available', following: true, followed_subjects: [jackWallet], remark: 'Wallet note', remark_subject: jackWallet},
};
describe('canonical actor presentation', () => {
  it('keeps the wallet identity while borrowing the named subject profile', () => {
    expect(normalizeActor(jackActor)).toMatchObject({identity: jackWallet, name: 'Jack', profileSubject: jackSubject, wallets: [jackWallet], followingPrimary: true, followedSubjects: [jackWallet], remarkSubject: jackWallet});
    expect(normalizeActor({...jackActor, identity: jackSubject})).toMatchObject({identity: jackSubject, name: 'Jack', wallets: [jackWallet], following: true, followingPrimary: false});
  });
  it('deduplicates related identities but preserves Solana case', () => {
    const actor = normalizeActor({...jackActor, related_identities: [jackWallet, jackWallet, jackSubject]});
    expect(actor.relatedIdentities).toHaveLength(2);
    expect(actor.wallets[0].address).toBe(jackWallet.address);
  });
  it('does not accept a subject ID as a wallet address or expose unavailable relations', () => {
    expect(() => normalizeActor({...jackActor, wallets: [jackSubject]})).toThrow('wallet identities');
    expect(normalizeActor({...jackActor, viewer: {...jackActor.viewer, state: 'unavailable'}})).toMatchObject({following: false, followingPrimary: false, followedSubjects: [], remark: undefined});
  });
});
