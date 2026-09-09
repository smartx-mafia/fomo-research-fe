import {describe, expect, it, vi} from 'vitest';
import {collectSquareTokens, createSquareTokenLoader, squareTokenKey, squareTokenRef, type SquareTokenRef} from './square-token-data';
import type {SquareFeedItem} from '@/api/social-content';
import type {TokenMarket} from './types';

const address = '0x' + 'ab'.repeat(20);
const ref: SquareTokenRef = {chain: 'base', address};
const signal = () => new AbortController().signal;
const item = (targetID: string) => ({content: {opinion: {targetID}}}) as SquareFeedItem;

describe('Square list-level token data', () => {
  it('deduplicates EVM addresses across opinions and cycles, but not across chains', () => {
    const refs = collectSquareTokens([
      item(`8453:erc20:${address}:1`), item(`8453:erc20:${address.toUpperCase().replace('0X', '0x')}:9`),
      item(`56:erc20:${address}:3`), item('bad'),
    ]);
    expect(refs).toHaveLength(2);
    expect(refs.map(squareTokenKey)).toEqual([`base:${address}`, `bsc:${address}`]);
  });
  it('preserves Solana case and rejects unsupported/malformed identities', () => {
    const mint = 'So11111111111111111111111111111111111111112';
    expect(squareTokenRef(`792703809:spl:${mint}:999999999999999999`)).toEqual({chain: 'solana', address: mint});
    for (const target of [`999:erc20:${address}:1`, `8453:spl:${address}:1`, `8453:erc20:bad:1`, `8453:erc20:${address}:0`]) {
      expect(squareTokenRef(target)).toBeUndefined();
    }
  });
  it('loads only missing refs, reuses lane/page cache, and expires it', async () => {
    let now = 100;
    const fetcher = vi.fn(async (chain: string, address: string) => ({chain, address, name: 'Token', logo: 'https://img.test/token.png'}));
    const load = createSquareTokenLoader(fetcher, () => now);
    const first = await load([ref, ref], signal());
    expect(first[squareTokenKey(ref)].logo).toBe('https://img.test/token.png');
    await load([ref], signal());
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 300001;
    await load([ref], signal());
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('isolates failures and rejects metadata for a different asset', async () => {
    const refs: SquareTokenRef[] = ['base', 'bsc', 'ethereum'].map(chain => ({chain: chain as SquareTokenRef['chain'], address}));
    const load = createSquareTokenLoader(async (chain, address) => {
      if (chain === 'bsc') throw new Error('unavailable');
      return {chain: chain === 'ethereum' ? 'base' : chain, address};
    });
    expect(Object.keys(await load(refs, signal()))).toEqual([squareTokenKey(ref)]);
  });
  it('limits concurrency to four and stops queued work after cancellation', async () => {
    const pending: Array<(value: TokenMarket) => void> = [];
    const fetcher = vi.fn(() => new Promise<TokenMarket>(resolve => pending.push(resolve)));
    const refs = Array.from({length: 10}, (_, i) => ({chain: 'base' as const, address: `0x${i.toString(16).padStart(40, '0')}`}));
    const controller = new AbortController();
    const load = createSquareTokenLoader(fetcher);
    const work = load(refs, controller.signal);
    expect(fetcher).toHaveBeenCalledTimes(4);
    controller.abort();
    pending.forEach((resolve, i) => resolve(refs[i]));
    expect(await work).toEqual({});
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('does not issue a request for an empty list', async () => {
    const fetcher = vi.fn();
    expect(await createSquareTokenLoader(fetcher)([], signal())).toEqual({});
    expect(fetcher).not.toHaveBeenCalled();
  });
});
