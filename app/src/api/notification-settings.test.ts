import {beforeEach, expect, it, vi} from 'vitest';
const {call} = vi.hoisted(() => ({call: vi.fn()}));
vi.mock('./envelope', () => ({call}));
import {setNotificationToggle, setMinimumTradeUSD, getNotificationPeople, setPersonNotifications, registerPushDevice, type NotificationToggle} from './settings';
beforeEach(() => call.mockReset());
it('uses canonical category endpoints and preserves explicit false', () => {
  const paths: Record<NotificationToggle, string> = {push: 'push', following: 'following', friend_trades: 'friends/trades', friend_opinions: 'friends/opinions', deposits_withdrawals: 'deposits-withdrawals', new_followers: 'new-followers', announcements: 'announcements'};
  for (const [key, path] of Object.entries(paths)) {
    setNotificationToggle('jwt', key as NotificationToggle, false);
    expect(call).toHaveBeenLastCalledWith(`/v1/settings/notifications/${path}`, {bearer: 'jwt', method: 'POST', body: {enabled: false}});
  }
  setMinimumTradeUSD('jwt', '1.000001');
  expect(call).toHaveBeenLastCalledWith('/v1/settings/notifications/minimum-trade-usd', {bearer: 'jwt', method: 'POST', body: {value: '1.000001'}});
});
it('encodes search and only modifies the requested subject preference', () => {
  getNotificationPeople('jwt', 'a&b', 2);
  expect(call).toHaveBeenLastCalledWith('/v1/settings/notifications/people?query=a%26b&page=2&page_size=20', {bearer: 'jwt'});
  setPersonNotifications('jwt', {type: 'smart_money_user', id: 'subject:7'}, {trades: false});
  expect(call).toHaveBeenLastCalledWith('/v1/settings/notifications/people', {bearer: 'jwt', method: 'POST', body: {scope: 'targets', targets: [{type: 'smart_money_user', id: 'subject:7'}], trades: false}});
});
it('registers native EngageLab identity without an Expo token', () => {
  const input = {provider: 'engagelab' as const, platform: 'ios' as const, registration_id: 'native-id', app_key: 'app', installation_id: '550e8400-e29b-41d4-a716-446655440000', application_id: 'io.example.app'};
  registerPushDevice('jwt', input);
  expect(call).toHaveBeenLastCalledWith('/v1/settings/devices/register', {bearer: 'jwt', method: 'POST', body: input});
  expect(call.mock.calls[0][1].body).not.toHaveProperty('push_token');
});
