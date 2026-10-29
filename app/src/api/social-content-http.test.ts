import {afterEach, describe, expect, it, vi} from 'vitest';
import {listSquareFeedPage, SQUARE_LANES, updateOpinion} from './social-content';

const address = `0x${'ab'.repeat(20)}`;
function feed() {
  return {items: [{type: 1, source_id: '9007199254740993', actor_identifier: 'alice', actor: {identifier: 'alice'}, sort_time: {seconds: 100, nanos: 0}, opinion: {
    opinion: {opinion_id: '9007199254740993', author_identifier: 'alice', target_type: 1, target_id: `56:erc20:${address}:9007199254740995`,
      latest_version: {version_id: '9007199254740994', version_no: 1, body: 'Position', items: [], published_at: {seconds: 100, nanos: 0}},
      created_at: {seconds: 100, nanos: 0}, updated_at: {seconds: 100, nanos: 0}},
    position: {asset: {chain: 'bsc', chain_id: '56', kind: 'erc20', token_address: address}, shares_raw: '0', opened_entry_id: '9007199254740995', cycle_status: 'ready', symbol: 'TOKEN', decimals: 0, pnl_ratio: '0.4', total_pnl_usd: '40'},
    token: {chain: 'bsc', address, symbol: 'TOKEN', name: 'Token', decimals: 0}, token_ready: true,
  }}]};
}
function serve(data: unknown) {
  // 真正模拟后端 JSON number；不能在 JS 对象里先舍入再测试。
  const raw = JSON.stringify({code: 200, data}).replace(/"(opinion_id|version_id|opened_entry_id|chain_id)":"(\d+)"/g, '"$1":$2');
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(raw, {status: 200}));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('Friends position compatibility', () => {
  it('reads pending positions without treating them as publishable cycles', async () => {
    const data = feed();
    const card = data.items[0].opinion;
    card.position.opened_entry_id = '0';
    card.position.cycle_status = 'pending';
    card.opinion.target_id = `56:erc20:${address}:0`;
    const fetcher = serve(data);
    const page = await listSquareFeedPage(SQUARE_LANES.FRIENDS, {bearer: 'test-session'});
    expect(page.items).toHaveLength(1);
    const item = page.items[0];
    if (item.type !== 1) throw new Error('expected opinion');
    expect(item.content.position.cycle_status).toBe('pending');
    expect(item.content.position.total_pnl_usd).toBeUndefined();
    expect((fetcher.mock.calls[0][1]?.headers as Record<string, string>).authorization).toBe('Bearer test-session');
  });
  it('validates v2 cycle keys and rejects a different cycle', async () => {
    const data = feed();
    const card = data.items[0].opinion;
    const cycle = 'external:snap:example:56:erc20:token:123';
    Object.assign(card.position, {opened_entry_id: '0', cycle_key: cycle});
    card.opinion.target_id = `v2:56:erc20:${address}:${Buffer.from(cycle).toString('base64url')}`;
    serve(data);
    expect((await listSquareFeedPage(SQUARE_LANES.FRIENDS, {bearer: 'test-session'})).items).toHaveLength(1);
    Object.assign(card.position, {cycle_key: 'external:snap:different'});
    serve(data);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(listSquareFeedPage(SQUARE_LANES.FRIENDS)).rejects.toThrow('identity mismatch');
  });
  it('keeps valid friends and pagination when one card is malformed', async () => {
    const valid = feed().items[0];
    const invalid = feed().items[0];
    invalid.opinion.opinion.target_id = 'wrong-position';
    serve({items: [invalid, valid], next_cursor: 'next-page', refresh_anchor: 'anchor'});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const page = await listSquareFeedPage(SQUARE_LANES.FRIENDS, {bearer: 'test-session'});
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe('next-page');
    expect(page.refreshAnchor).toBe('anchor');
    expect(warn).toHaveBeenCalledOnce();
  });
});
describe('Social standard Position wire contract', () => {
  it('preserves all int64 identities and permits closed cycles and real zero decimals', async () => {
    serve(feed());
    const item = (await listSquareFeedPage(SQUARE_LANES.NEWEST)).items[0];
    if (!item || item.type !== 1) throw new Error('expected opinion item');
    expect(item.content.opinion.opinionID).toBe('9007199254740993');
    expect(item.content.opinion.latestVersion.versionID).toBe('9007199254740994');
    expect(item.content.position.opened_entry_id).toBe('9007199254740995');
    expect(item.content.position.shares_raw).toBe('0');
    expect(item.content.token?.decimals).toBe(0);
    expect(item.content.position.pnl_ratio).toBe('0.4');
  });
  it('rejects the legacy summary and mismatched token/position identities', async () => {
    const data = feed();
    data.items[0].opinion.token.address = `0x${'cd'.repeat(20)}`;
    serve(data);
    await expect(listSquareFeedPage(SQUARE_LANES.NEWEST)).rejects.toThrow('does not match');
    const legacy = feed();
    Object.assign(legacy.items[0].opinion, {position: {pnl_percent: '40', token_symbol: 'TOKEN', quality: ''}});
    serve(legacy);
    await expect(listSquareFeedPage(SQUARE_LANES.NEWEST)).rejects.toThrow('position identity');
  });
  it('sends exact large IDs in edit paths and optimistic-concurrency bodies', async () => {
    const fetcher = serve({opinion: feed().items[0].opinion.opinion});
    await updateOpinion('jwt', '9007199254740993', {baseVersionID: '9007199254740994', body: 'Update', idempotencyKey: 'key'});
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('/opinions/9007199254740993');
    expect(JSON.parse((fetcher.mock.calls as unknown as [string, RequestInit][])[0][1].body as string).base_version_id).toBe('9007199254740994');
  });
});


it('reads attached translations with explicit language without changing original or int64 IDs', async () => {
  const data = feed();
  Object.assign(data.items[0].opinion.opinion.latest_version, {translation: {status:'ready',target_locale:'zh-Hans',translated_text:'译文 👩‍💻'}});
  const fetcher = serve(data);
  const item = (await listSquareFeedPage(SQUARE_LANES.NEWEST, {language:'zh-Hans'})).items[0];
  if (!item || item.type !== 1) throw new Error('expected opinion');
  expect(item.content.opinion.latestVersion).toMatchObject({versionID:'9007199254740994',body:'Position',translation:{status:'ready',targetLocale:'zh-Hans',translatedText:'译文 👩‍💻'}});
  expect((fetcher.mock.calls[0][1]?.headers as Record<string,string>)['Accept-Language']).toBe('zh-Hans');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
