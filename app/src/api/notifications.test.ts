import {afterEach, expect, it, vi} from 'vitest';
import {getNotifications, getNotificationUnread, markAllNotificationsRead, markNotificationRead} from './notifications';

afterEach(() => vi.unstubAllGlobals());
function respond(data: unknown) {return new Response(JSON.stringify({code: 200, data}), {status: 200});}

it('reads without marking notifications and preserves exact int64 identities', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{"code":200,"data":{"list":[{"id":9223372036854775806,"code":"new_followers","title":"3 new followers","content":"See who followed you","is_read":false,"created_at":1793000000,"presentation":{"version":1,"language":"en","kind":"new_followers","icon":"followers","badge":"follow","actor":null,"subtitle":"See who followed you","status":null}}],"total":1,"page":1,"page_size":20}}'));
  vi.stubGlobal('fetch', fetch);
  const result = await getNotifications('jwt');
  const [url, options] = fetch.mock.calls[0];
  expect(new URL(url).pathname).toBe('/notification/list');
  expect(new URL(url).searchParams.get('mark_read')).toBe('false');
  expect(options.headers.authorization).toBe('Bearer jwt');
  expect(result.list[0].id).toBe('9223372036854775806');
  expect(result.list[0].presentation?.actor).toBe(null);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('uses legacy text for missing or future presentation versions', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({list: [{id: 1, code: 'old', title: 'Old title', content: 'Old body', is_read: true, created_at: 1, presentation: {version: 2}}], total: 1, page: 1, page_size: 20})));
  expect((await getNotifications('jwt')).list[0]).toMatchObject({title: 'Old title', presentation: null});
});

it('rejects malformed rows and unread counts rather than inventing empty or all-read states', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(respond({list: [{id: 1, title: 'Missing fields'}], total: 1, page: 1, page_size: 20})).mockResolvedValueOnce(respond({total: -1})));
  await expect(getNotifications('jwt')).rejects.toThrow('Invalid notification');
  await expect(getNotificationUnread('jwt')).rejects.toThrow('Invalid unread count');
});

it('only writes to the dedicated read endpoints', async () => {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(respond({})));
  vi.stubGlobal('fetch', fetch);
  await markNotificationRead('jwt', '123'); await markAllNotificationsRead('jwt');
  expect(new URL(fetch.mock.calls[0][0]).pathname).toBe('/notification/read');
  expect(new URL(fetch.mock.calls[0][0]).searchParams.get('id')).toBe('123');
  expect(new URL(fetch.mock.calls[1][0]).pathname).toBe('/notification/read_all');
  await expect(markNotificationRead('jwt', '1&mark_all=true')).rejects.toThrow('Invalid notification id');
  expect(fetch).toHaveBeenCalledTimes(2);
});
