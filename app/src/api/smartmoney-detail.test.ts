import {expect, it, vi} from 'vitest';
const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));
import {getSmartMoneyDetail, smartMoneyDetailQueryKey} from './smartmoney-detail';

it('builds the wallet identity query without a bearer', async () => {
  const data = {identity: {type: 'wallet'}, enabled: true};
  callMock.mockResolvedValue({data});
  expect(await getSmartMoneyDetail({identity_type: 'wallet', namespace: 'evm', wallet_address: '0xAbC'})).toBe(data);
  expect(callMock).toHaveBeenCalledWith('/v1/smartmoney/detail?identity_type=wallet&namespace=evm&wallet_address=0xAbC', {signal: undefined});
});

it('builds the user identity query, encoding the subject id', async () => {
  callMock.mockResolvedValue({data: {}});
  await getSmartMoneyDetail({identity_type: 'user', user_id: 'subject:3'});
  expect(callMock).toHaveBeenCalledWith('/v1/smartmoney/detail?identity_type=user&user_id=subject%3A3', {signal: undefined});
});

it('keys differ across identity branches and wallets', () => {
  const keys = [
    smartMoneyDetailQueryKey({identity_type: 'user', user_id: 'subject:3'}),
    smartMoneyDetailQueryKey({identity_type: 'wallet', namespace: 'evm', wallet_address: '0xabc'}),
    smartMoneyDetailQueryKey({identity_type: 'wallet', namespace: 'solana', wallet_address: '0xabc'}),
  ];
  expect(new Set(keys).size).toBe(3);
});
