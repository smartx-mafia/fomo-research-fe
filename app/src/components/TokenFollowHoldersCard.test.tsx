// @vitest-environment jsdom
/**
 * TokenFollowHoldersCard（social.md §5.3 + social-follow-holders.md）：
 * - 未登录（无 bearer）不渲染、不发请求（§0 无匿名语义）；
 * - 回包带 token.decimals 时按 shares/10^decimals 换算人类可读量（§2）；
 * - 空 items 不是错误：整块不渲染（块只在「关注的人真的持有」时存在）；
 * - 链标识归一：eth→ethereum（§2 链 slug 小写，非聪明钱面的 sol）。
 */
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {getTokenFollowHolders} = vi.hoisted(() => ({getTokenFollowHolders: vi.fn()}));

// socialDisplayName / shortIdentifier 用真实实现（展示名回退链是被测行为的一部分）。
vi.mock('@/api/social', async () => {
  const actual = await vi.importActual<typeof import('@/api/social')>('@/api/social');
  return {...actual, getTokenFollowHolders};
});

import {TokenFollowHoldersCard} from './TokenFollowHoldersCard';

/** 实测回包形状（social-follow-holders.md §3.3），identifier 缩短。 */
const REPLY = {
  token: {chain: 'ethereum', address: '0xtoken', symbol: 'PEPE', name: 'Pepe', decimals: 18},
  items: [
    {user: {identifier: 'u-alice', username: 'alice', nickname: 'Alice', avatar_url: ''}, shares: '347000000000000000000', cost_usd: '1234', pnl_percent: '16.6977', remark: '老王'},
    {user: {identifier: 'u-bob', username: 'bob_eth', nickname: '', avatar_url: ''}, shares: '120000000000000000000', cost_usd: '50', pnl_percent: ''},
  ],
  total: 2,
};

beforeEach(() => getTokenFollowHolders.mockReset());
// vitest 没开 globals，testing-library 的自动 cleanup 不会注册，手动清。
afterEach(() => cleanup());

describe('TokenFollowHoldersCard', () => {
  it('无 bearer 不渲染、不发请求（§0）', () => {
    const {container} = render(<TokenFollowHoldersCard bearer={null} chain="ethereum" address="0xtoken" />);
    expect(container.firstChild).toBeNull();
    expect(getTokenFollowHolders).not.toHaveBeenCalled();
  });

  it('有 token.decimals 时按 10^decimals 换算 shares；备注优先取名并加徽标；空串 pnl 显示 —', async () => {
    getTokenFollowHolders.mockResolvedValue({data: REPLY});
    const {container} = render(<TokenFollowHoldersCard bearer="jwt" chain="eth" address="0xtoken" />);

    // 链标识归一：eth → ethereum（§2）。
    await waitFor(() =>
      expect(getTokenFollowHolders).toHaveBeenCalledWith('jwt', 'ethereum', '0xtoken', {limit: 20}),
    );

    // 347000000000000000000 / 10^18 = 347；120000000000000000000 / 10^18 = 120。
    expect(await screen.findByText('347')).toBeTruthy();
    expect(screen.getByText('120')).toBeTruthy();

    // 展示名回退：remark「老王」优先 + 备注「备注」徽标，次要行保留 @alice；无备注 → @bob_eth。
    expect(screen.getByText('老王')).toBeTruthy();
    expect(screen.getByText('备注')).toBeTruthy();
    expect(screen.getByText('@alice')).toBeTruthy();
    expect(screen.getByText('@bob_eth')).toBeTruthy();

    // 整行链到用户资料页（整页 <a>）。
    const aliceLink = screen.getByText('老王').closest('a');
    expect(aliceLink?.getAttribute('href')).toBe('/user/u-alice');

    // pnl_percent "16.6977" → +16.7%；空串不是 0 → «—»；cost_usd 有值展示。
    expect(screen.getByText('+16.7%')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('$1,234')).toBeTruthy();
    expect(screen.getByText('$50')).toBeTruthy();

    // total 提示。
    expect(screen.getByText('你关注的人中 2 人持有')).toBeTruthy();

    expect(container.querySelector('ul')?.children.length).toBe(2);
  });

  it('空 items 不渲染任何东西（块只在有人持有时存在）', async () => {
    getTokenFollowHolders.mockResolvedValue({data: {}});
    const {container} = render(<TokenFollowHoldersCard bearer="jwt" chain="bsc" address="0xdead" />);

    await waitFor(() => expect(getTokenFollowHolders).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('token 缺席时不换算（精度未知），原串缩短展示', async () => {
    getTokenFollowHolders.mockResolvedValue({
      data: {
        items: [{user: {identifier: 'u-carol'}, shares: '347000000000000000000', cost_usd: '', pnl_percent: ''}],
        total: 1,
      },
    });
    render(<TokenFollowHoldersCard bearer="jwt" chain="solana" address="MintAddr" />);

    // 缩短展示 + 精度未知徽标；绝不拿 decimals 0 当精度（§2）。
    expect(await screen.findByText('3.470e+20')).toBeTruthy();
    expect(screen.getByText('精度未知')).toBeTruthy();
    expect(screen.queryByText('347')).toBeNull();
  });
});
