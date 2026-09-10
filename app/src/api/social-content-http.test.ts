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
afterEach(() => vi.unstubAllGlobals());
describe('Social standard Position wire contract', () => {
  it('preserves all int64 identities and permits closed cycles and real zero decimals', async () => {
    serve(feed());
    const item = (await listSquareFeedPage(SQUARE_LANES.NEWEST)).items[0];
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
