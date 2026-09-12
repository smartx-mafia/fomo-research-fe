// @vitest-environment jsdom
/**
 * PeopleView（/people 关注域主页，social.md §5 / §5.2 / §5.5）：
 * - 未登录出「去登录」卡，不调任何接口；登录后头部拉 follow-counts（缺省 = 本人）；
 * - 页签切换各拉各的源（following / recommended-traders / follow-suggestions / remarks）；
 * - 混合列表行渲染：remark → nickname → @username → 缩写的展示名链、备注徽标、
 *   聪明钱 chains 取第一条拼 /smart-money/:chain/:address、无链给「未收录」；
 * - 取关乐观流：先移除行，成功重拉计数，失败回滚 + ErrorPanel；
 * - 翻页遇 100103（BIZ_CURSOR_INVALID）：丢弃 cursor 重拉首屏（§1.4）。
 */
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {
  followTarget,
  getFollowCounts,
  getFollowSuggestions,
  getFollowing,
  getRecommendedTraders,
  listRemarks,
  setRemark,
  unfollowTarget,
  useSession,
} = vi.hoisted(() => ({
  followTarget: vi.fn(),
  getFollowCounts: vi.fn(),
  getFollowSuggestions: vi.fn(),
  getFollowing: vi.fn(),
  getRecommendedTraders: vi.fn(),
  listRemarks: vi.fn(),
  setRemark: vi.fn(),
  unfollowTarget: vi.fn(),
  useSession: vi.fn(),
}));

// 纯函数（socialDisplayName / shortIdentifier）保留真实现 —— 行渲染断言才有契约意义。
vi.mock('@/api/social', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/social')>();
  return {
    ...actual,
    followTarget,
    getFollowCounts,
    getFollowSuggestions,
    getFollowing,
    getRecommendedTraders,
    listRemarks,
    setRemark,
    unfollowTarget,
  };
});
vi.mock('@/session/storage', () => ({useSession}));

import {ApiError} from '@/api/envelope';
import type {FollowEntry} from '@/api/social';
import {PeopleView} from './PeopleView';

/** 混合列表实测形状（social.md §5 关注列表），识别串缩短。 */
const USER_WITH_REMARK: FollowEntry = {
  followed_at: {seconds: 1788520620, nanos: 390464000},
  target_type: 'user',
  remark: '我的备注名',
  user: {identifier: 'pp-u01', username: 'ppu01', nickname: '皮皮丑', avatar_url: ''},
};
const SM_WITH_CHAINS: FollowEntry = {
  followed_at: {seconds: 1788520620, nanos: 455205000},
  target_type: 'smart_money',
  smart_money: {address: '0x1d10f5385b81929f5e6db43dfc4e6a941e02422c', chains: ['bsc', 'sol']},
};
const SM_NO_CHAINS: FollowEntry = {
  followed_at: {seconds: 1788520621},
  target_type: 'smart_money',
  smart_money: {address: '0x0000000000000000000000000000000000000001'},
};
const TRADER = {
  rank: 1,
  user: {identifier: 'pp-t01', username: 'aguuuuuu', nickname: 'Aguuuuu', avatar_url: ''},
  pnl_usd: '5900.43000000',
};

const renderPeople = () => render(<PeopleView />);

beforeEach(() => {
  followTarget.mockReset();
  getFollowCounts.mockReset();
  getFollowSuggestions.mockReset();
  getFollowing.mockReset();
  getRecommendedTraders.mockReset();
  listRemarks.mockReset();
  setRemark.mockReset();
  unfollowTarget.mockReset();
  useSession.mockReset();
  useSession.mockReturnValue({jwt: 'jwt', user: null, meta: null});
  getFollowCounts.mockResolvedValue({data: {following_count: 2, follower_count: 1}});
  getFollowing.mockResolvedValue({data: {entries: [], next_cursor: ''}});
  getRecommendedTraders.mockResolvedValue({data: {window: '7d', as_of: {seconds: 0}, traders: []}});
  getFollowSuggestions.mockResolvedValue({data: {suggestions: []}});
  listRemarks.mockResolvedValue({data: {entries: [], next_cursor: ''}});
});

// vitest 没开 globals，testing-library 的自动 cleanup 不会注册，手动清。
afterEach(() => cleanup());

describe('PeopleView 登录门与头部计数', () => {
  it('未登录：去登录卡，不调任何接口', () => {
    useSession.mockReturnValue(null);
    renderPeople();

    expect(screen.getByText('去登录')).toBeTruthy();
    expect(getFollowing).not.toHaveBeenCalled();
    expect(getFollowCounts).not.toHaveBeenCalled();
  });

  it('登录后头部拉 follow-counts（缺省 = 本人）并按 §5.5 口径提示', async () => {
    renderPeople();

    await waitFor(() => expect(getFollowCounts).toHaveBeenCalledTimes(1));
    expect(getFollowCounts).toHaveBeenCalledWith('jwt');
    expect(screen.getByText((_, el) => el?.textContent === '关注 2 / 粉丝 1')).toBeTruthy();
    expect(screen.getByText(/只含平台用户，聪明钱不计入/)).toBeTruthy();
  });
});

describe('PeopleView 页签切换', () => {
  it('空关注列表给兜底文案；各页签拉各自的源', async () => {
    const user = userEvent.setup();
    renderPeople();

    // 默认第一页签「我的关注」；空列表不是错误，给兜底 + 去推荐。
    expect(await screen.findByText('还没有关注任何目标')).toBeTruthy();
    expect(getFollowing).toHaveBeenCalledWith('jwt', {limit: 20});

    await user.click(screen.getByRole('button', {name: '去推荐看看'}));
    await waitFor(() => expect(getRecommendedTraders).toHaveBeenCalledWith('jwt'));

    await user.click(screen.getByRole('button', {name: '可能认识的人'}));
    await waitFor(() => expect(getFollowSuggestions).toHaveBeenCalledWith('jwt', 20));

    await user.click(screen.getByRole('button', {name: '我的备注'}));
    await waitFor(() => expect(listRemarks).toHaveBeenCalledWith('jwt', {limit: 50}));
  });
});

describe('PeopleView 我的关注（混合列表）', () => {
  it('展示名链 / 备注徽标 / 聪明钱链与「未收录」', async () => {
    getFollowing.mockResolvedValue({
      data: {entries: [USER_WITH_REMARK, SM_WITH_CHAINS, SM_NO_CHAINS], next_cursor: ''},
    });
    renderPeople();

    // remark 优先 + 「备注」徽标；@username 作次行。
    expect(await screen.findByText('我的备注名')).toBeTruthy();
    expect(screen.getByText('备注')).toBeTruthy();
    expect(screen.getByText('@ppu01')).toBeTruthy();
    expect(screen.getByText('我的备注名').closest('a')?.getAttribute('href')).toBe('/user/pp-u01');

    // 聪明钱：chains 取第一条（bsc）拼整页跳转；无链行只渲染地址 + 「未收录」。
    expect(screen.getByText('0x1d10…422c')).toBeTruthy();
    expect(screen.getByText('0x1d10…422c').closest('a')?.getAttribute('href')).toBe(
      '/smart-money/bsc/0x1d10f5385b81929f5e6db43dfc4e6a941e02422c',
    );
    expect(screen.getByText('0x0000…0001').closest('a')).toBeNull();
    expect(screen.getByText('未收录')).toBeTruthy();
  });

  it('取关：乐观移除（不等回包）→ 成功后重拉计数（§5.5 实时）', async () => {
    const user = userEvent.setup();
    getFollowing.mockResolvedValue({data: {entries: [USER_WITH_REMARK], next_cursor: ''}});
    let resolveUnfollow!: () => void;
    unfollowTarget.mockImplementation(() => new Promise<void>((res) => (resolveUnfollow = res)));
    renderPeople();
    await screen.findByText('我的备注名');

    await user.click(screen.getByRole('button', {name: '取关'}));
    // 回包未到，行已经消失 = 乐观移除。
    await waitFor(() => expect(screen.queryByText('我的备注名')).toBeNull());
    expect(unfollowTarget).toHaveBeenCalledWith('jwt', 'user', 'pp-u01');
    expect(getFollowCounts).toHaveBeenCalledTimes(1);

    resolveUnfollow();
    await waitFor(() => expect(getFollowCounts).toHaveBeenCalledTimes(2));
  });

  it('取关失败：行回滚原位 + ErrorPanel 面板', async () => {
    const user = userEvent.setup();
    getFollowing.mockResolvedValue({data: {entries: [USER_WITH_REMARK], next_cursor: ''}});
    // 受控 rejection：先观察乐观移除，再触发失败走回滚。
    let rejectUnfollow!: (e: unknown) => void;
    unfollowTarget.mockImplementation(() => new Promise<void>((_, reject) => (rejectUnfollow = reject)));
    renderPeople();
    await screen.findByText('我的备注名');

    await user.click(screen.getByRole('button', {name: '取关'}));
    await waitFor(() => expect(screen.queryByText('我的备注名')).toBeNull());

    rejectUnfollow(new ApiError('business', 430101, 'target restricted'));
    // 失败回滚：行塞回原位，错误经 ErrorPanel 呈现（430114 同样不特判走这里）。
    expect(await screen.findByText('我的备注名')).toBeTruthy();
    expect(screen.getByText('430101')).toBeTruthy();
  });

  it('加载更多遇 100103：丢弃 cursor 重拉首屏（§1.4）', async () => {
    const user = userEvent.setup();
    getFollowing
      .mockResolvedValueOnce({data: {entries: [USER_WITH_REMARK], next_cursor: 'cur-1'}})
      .mockRejectedValueOnce(new ApiError('business', 100103, 'cursor invalid'))
      .mockResolvedValueOnce({data: {entries: [USER_WITH_REMARK], next_cursor: ''}});
    renderPeople();

    await user.click(await screen.findByRole('button', {name: '加载更多'}));
    await waitFor(() => expect(getFollowing).toHaveBeenCalledTimes(3));
    expect(getFollowing).toHaveBeenNthCalledWith(2, 'jwt', {cursor: 'cur-1', limit: 20});
    // 第三次 = 重拉首屏：cursor 已被丢弃。
    expect(getFollowing).toHaveBeenNthCalledWith(3, 'jwt', {limit: 20});
    // next_cursor 空串 = 到底了，「加载更多」消失。
    expect(screen.queryByRole('button', {name: '加载更多'})).toBeNull();
  });
});

describe('PeopleView 推荐交易者（§5.4）', () => {
  it('pnl_usd 按字符串格式化；Follow 成功置灰并重拉计数', async () => {
    const user = userEvent.setup();
    getRecommendedTraders.mockResolvedValue({
      data: {window: '7d', as_of: {seconds: 1789030800}, traders: [TRADER]},
    });
    followTarget.mockResolvedValue({data: {following: true, changed: true}});
    renderPeople();

    await user.click(screen.getByRole('button', {name: '推荐交易者'}));
    // "5900.43000000" → $5,900.43（不经 float）。
    expect(await screen.findByText('$5,900.43')).toBeTruthy();

    await user.click(screen.getByRole('button', {name: 'Follow'}));
    expect(await screen.findByRole('button', {name: '已关注'})).toBeTruthy();
    expect(followTarget).toHaveBeenCalledWith('jwt', 'user', 'pp-t01');
    expect(getFollowCounts).toHaveBeenCalledTimes(2);
  });
});

describe('PeopleView 可能认识的人（§5）', () => {
  it('identifier 缩写 + via 文案；Follow 成功后行移除', async () => {
    const user = userEvent.setup();
    getFollowSuggestions.mockResolvedValue({
      data: {suggestions: [{user_identifier: 'cap-abcdefghij-xyz', via_count: 3}]},
    });
    followTarget.mockResolvedValue({data: {following: true}});
    renderPeople();

    await user.click(screen.getByRole('button', {name: '可能认识的人'}));
    // 契约只回 user_identifier + via_count：缩写展示，前 6…后 4。
    expect(await screen.findByText('cap-ab…-xyz')).toBeTruthy();
    expect(screen.getByText('3 位你关注的人也关注了 TA')).toBeTruthy();

    await user.click(screen.getByRole('button', {name: 'Follow'}));
    await waitFor(() => expect(screen.queryByText('cap-ab…-xyz')).toBeNull());
    expect(followTarget).toHaveBeenCalledWith('jwt', 'user', 'cap-abcdefghij-xyz');
  });
});

describe('PeopleView 我的备注（§5.2）', () => {
  it('清除 = setRemark 空串并移除行；聪明钱行无跳转链接', async () => {
    const user = userEvent.setup();
    listRemarks.mockResolvedValue({
      data: {
        entries: [
          {target_type: 'user', target_id: 'pp-u01', remark: 'my fan', updated_at: {seconds: 1788163356}},
          {target_type: 'smart_money', target_id: '0x1d10f5385b81929f5e6db43dfc4e6a941e02422c', remark: 'sharp shooter'},
        ],
        next_cursor: '',
      },
    });
    setRemark.mockResolvedValue({data: {changed: true}});
    renderPeople();

    await user.click(screen.getByRole('button', {name: '我的备注'}));
    expect(await screen.findByText(/my fan/)).toBeTruthy();
    // 备注列表没有 chains 字段：只有用户行给「跳转」。
    expect(screen.getByText('跳转')).toBeTruthy();

    await user.click(screen.getAllByRole('button', {name: '清除'})[0]);
    await waitFor(() => expect(setRemark).toHaveBeenCalledWith('jwt', 'user', 'pp-u01', ''));
    await waitFor(() => expect(screen.queryByText(/my fan/)).toBeNull());
    // 聪明钱行不受影响。
    expect(screen.getByText(/sharp shooter/)).toBeTruthy();
  });
});
