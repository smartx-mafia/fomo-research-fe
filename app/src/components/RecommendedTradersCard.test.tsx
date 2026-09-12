// @vitest-environment jsdom
/**
 * RecommendedTradersCard（social.md §5.4，Onboarding 步骤 ④）：
 * - 行渲染：pnl_usd 十进制字符串裁尾零 + 千分位 + $（全程字符串操作，不经
 *   float）；勾选初值取服务端 preselected（规则归服务端，不写死前三）；
 * - CTA：先按请求顺序批量关注勾选行 → 再 skip 记 recommended_traders
 *   （不论关注了几个）→ 最后 onDone 交父组件 refresh()；
 * - 空列表不是错误：展示「稍后在 People 关注」兜底 + as_of 全零说明，
 *   「继续」仍要调 skip（零关注也继续），且不发批量关注。
 */
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {batchFollowUsers, followTarget, getRecommendedTraders, skipOnboarding} = vi.hoisted(() => ({
  batchFollowUsers: vi.fn(),
  followTarget: vi.fn(),
  getRecommendedTraders: vi.fn(),
  skipOnboarding: vi.fn(),
}));

vi.mock('@/api/social', () => ({batchFollowUsers, followTarget, getRecommendedTraders}));
vi.mock('@/api/onboarding', () => ({skipOnboarding}));

import {RecommendedTradersCard} from './RecommendedTradersCard';

const onDone = vi.fn();

/** 实测回包形状（social.md §5.4），识别串缩短。rank1/rank3 预选。 */
const TRADERS = [
  {
    rank: 1,
    user: {identifier: 'rt-t01', username: 'aguuuuuu', nickname: 'Aguuuuu', avatar_url: 'https://cdn.example/a.png'},
    pnl_usd: '5900.43000000',
    preselected: true,
  },
  {
    rank: 2,
    user: {identifier: 'rt-t03', username: 'xiaoliu6666', nickname: 'XIAOLIU6666', avatar_url: ''},
    pnl_usd: '5700.00000000',
    preselected: false,
  },
  {
    rank: 3,
    user: {identifier: 'rt-t04', username: '', nickname: '', avatar_url: ''},
    pnl_usd: '5600.50000000',
    preselected: true,
  },
];

const setup = () => render(<RecommendedTradersCard bearer="jwt" onDone={onDone} />);

beforeEach(() => {
  batchFollowUsers.mockReset();
  followTarget.mockReset();
  getRecommendedTraders.mockReset();
  skipOnboarding.mockReset();
  onDone.mockReset();
});

// vitest 没开 globals，testing-library 的自动 cleanup 不会注册，手动清。
afterEach(() => cleanup());

describe('RecommendedTradersCard 榜单渲染', () => {
  it('pnl_usd 裁尾零 + 千分位 + $（不经 float）；勾选初值取服务端 preselected', async () => {
    getRecommendedTraders.mockResolvedValue({
      data: {window: '7d', as_of: {seconds: 1789030800, nanos: 0}, traders: TRADERS},
    });
    setup();

    // "5900.43000000" → $5,900.43；"5700.00000000" → $5,700；"5600.50000000" → $5,600.5
    expect(await screen.findByText('$5,900.43')).toBeTruthy();
    expect(screen.getByText('$5,700')).toBeTruthy();
    expect(screen.getByText('$5,600.5')).toBeTruthy();
    // 标签恒「7D P&L」（window 恒 7d）。
    expect(screen.getAllByText('7D P&L').length).toBe(3);

    // 展示名兜底链：nickname 与 @username 同显；两者皆空 → 未设置用户名。
    expect(screen.getByText('@xiaoliu6666')).toBeTruthy();
    expect(screen.getByText('未设置用户名')).toBeTruthy();

    // preselected=true 的行（rank1 / rank3）默认勾选，false 的行不勾。
    expect(screen.getByRole('checkbox', {name: '关注 Aguuuuu'})).toHaveProperty('checked', true);
    expect(screen.getByRole('checkbox', {name: '关注 XIAOLIU6666'})).toHaveProperty('checked', false);
    expect(screen.getByRole('checkbox', {name: '关注 未设置用户名'})).toHaveProperty('checked', true);
  });
});

describe('RecommendedTradersCard CTA（social.md §5.4）', () => {
  it('勾选 2 行：batchFollowUsers 按请求顺序收 identifiers → skip(recommended_traders) → onDone', async () => {
    const user = userEvent.setup();
    getRecommendedTraders.mockResolvedValue({
      data: {window: '7d', as_of: {seconds: 1789030800}, traders: TRADERS},
    });
    batchFollowUsers.mockResolvedValue({
      data: {
        results: [
          {user_identifier: 'rt-t01', outcome: 1},
          {user_identifier: 'rt-t04', outcome: 1},
        ],
      },
    });
    skipOnboarding.mockResolvedValue({data: {items: []}});
    setup();

    // preselected 即 rank1 + rank3 → N=2。
    await user.click(await screen.findByRole('button', {name: 'Follow 2 and continue'}));
    await waitFor(() => expect(onDone).toHaveBeenCalled());

    expect(batchFollowUsers).toHaveBeenCalledTimes(1);
    expect(batchFollowUsers).toHaveBeenCalledWith('jwt', ['rt-t01', 'rt-t04']);
    expect(skipOnboarding).toHaveBeenCalledTimes(1);
    expect(skipOnboarding).toHaveBeenCalledWith('jwt', 'recommended_traders');

    // 顺序：批量关注 → skip → onDone。
    expect(batchFollowUsers.mock.invocationCallOrder[0]).toBeLessThan(skipOnboarding.mock.invocationCallOrder[0]);
    expect(skipOnboarding.mock.invocationCallOrder[0]).toBeLessThan(onDone.mock.invocationCallOrder[0]);
  });
});

describe('RecommendedTradersCard 空列表（三种来源同一形状）', () => {
  it('展示兜底文案与 as_of 全零说明；「继续」仍调 skip，不发批量关注', async () => {
    const user = userEvent.setup();
    // 榜不可用的实测形状：as_of 全零对象 + 空 traders。
    getRecommendedTraders.mockResolvedValue({data: {window: '7d', as_of: {seconds: 0, nanos: 0}, traders: []}});
    skipOnboarding.mockResolvedValue({data: {items: []}});
    setup();

    expect(await screen.findByText('暂时没有推荐，可稍后在 People 关注交易者')).toBeTruthy();
    expect(screen.getByText(/榜单还没算好/)).toBeTruthy();

    await user.click(screen.getByRole('button', {name: '继续'}));
    await waitFor(() => expect(onDone).toHaveBeenCalled());

    expect(skipOnboarding).toHaveBeenCalledWith('jwt', 'recommended_traders');
    // 零关注继续：契约允许不发批量端点。
    expect(batchFollowUsers).not.toHaveBeenCalled();
  });
});
