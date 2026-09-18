import {beforeEach, expect, it, vi} from 'vitest';
const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
// 保留真实的 ApiError：isTradeCursorStale 靠 instanceof 判类型，整体替换掉
// envelope 会让它变成 undefined 并在 instanceof 上抛 TypeError。
vi.mock('./envelope', async (original) => ({...await original<object>(), call: callMock}));
import {ApiError} from './envelope';
import {getPlatformUserTrades, getPlatformUserPositionTrades, isTradeCursorStale} from './platform-trades';

beforeEach(() => {callMock.mockClear();});

it('loads the first user-trade page without a cursor', async () => {
  const data = {list: [], next_cursor: '', wallets: []};
  callMock.mockResolvedValue({data});
  expect(await getPlatformUserTrades('subject:3')).toBe(data);
  expect(callMock).toHaveBeenLastCalledWith('/v1/smartmoney/new-trades?subject_type=external_user&user_id=subject%3A3', {signal: undefined});
});

it('passes the opaque cursor back unchanged', async () => {
  callMock.mockResolvedValue({data: {list: []}});
  await getPlatformUserTrades('subject:3', 'eyJhdCI6MTc4OTQ5NTQ0Mn0=');
  expect(callMock).toHaveBeenLastCalledWith('/v1/smartmoney/new-trades?subject_type=external_user&user_id=subject%3A3&cursor=eyJhdCI6MTc4OTQ5NTQ0Mn0%3D', {signal: undefined});
});

it('requests one user position by the chain:token position ID', async () => {
  const data = {list: [], coverage: 'partial', position_id: 'sol:9cRC'};
  callMock.mockResolvedValue({data});
  expect(await getPlatformUserPositionTrades('subject:3', 'sol:9cRC')).toBe(data);
  expect(callMock).toHaveBeenLastCalledWith('/v1/smartmoney/new-position-trades?subject_type=external_user&user_id=subject%3A3&position_id=sol%3A9cRC', {signal: undefined});
});

it('rejects an empty user or position ID before calling the API', async () => {
  await expect(getPlatformUserTrades('  ')).rejects.toThrow('A platform user ID is required.');
  await expect(getPlatformUserPositionTrades('subject:3', '')).rejects.toThrow('A position ID is required.');
  expect(callMock).not.toHaveBeenCalled();
});

it('recognizes only the 100110 business code as a possibly-stale pagination cursor', () => {
  expect(isTradeCursorStale(new ApiError('business', 100110, 'smdetail invalid param', 'BIZ_SMDETAIL_INVALID_PARAM'))).toBe(true);
  expect(isTradeCursorStale(new ApiError('business', 500103, 'store unavailable', 'BIZ_SMDETAIL_STORE_UNAVAILABLE'))).toBe(false);
  expect(isTradeCursorStale(new Error('100110'))).toBe(false);
  expect(isTradeCursorStale(undefined)).toBe(false);
});
