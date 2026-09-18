import {expect, it, vi} from 'vitest';
const {callMock} = vi.hoisted(() => ({callMock: vi.fn()}));
vi.mock('./envelope', () => ({call: callMock}));
import {getPlatformHoldings} from './platform-holdings';

it.each(['fomo', 'pump'] as const)('loads %s all-chain holdings with the full encoded subject ID', async (platform) => {
  const data = {list: [], coverage: 'partial'};
  callMock.mockResolvedValue({data});
  expect(await getPlatformHoldings(platform, 'subject:3')).toBe(data);
  expect(callMock).toHaveBeenLastCalledWith(`/v1/smartmoney/platforms/${platform}/users/subject%3A3/holdings?chain=all`, {preserveInt64Fields: ['mapping_version']});
});
