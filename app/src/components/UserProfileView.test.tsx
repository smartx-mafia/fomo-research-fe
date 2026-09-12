// @vitest-environment jsdom
/**
 * 客态用户主页（/user/:identifier）：
 * - 路径参数解析（/user/:identifier 与 ?identifier= 双来源）；
 * - 头部客态聚合：profile（200102 → 用户不存在）、follow-counts、relations（following + followed_by）、
 *   known-followers（total=100 → 100+）；
 * - 本人视角不显示关注按钮，显示「编辑资料」；
 * - 备注编辑：设置与清除（空串）走同一端点。
 */
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {
  getUserPublicProfile,
  getFollowCounts,
  getRelations,
  getKnownFollowers,
  followTarget,
  unfollowTarget,
  setRemark,
} = vi.hoisted(() => ({
  getUserPublicProfile: vi.fn(),
  getFollowCounts: vi.fn(),
  getRelations: vi.fn(),
  getKnownFollowers: vi.fn(),
  followTarget: vi.fn(),
  unfollowTarget: vi.fn(),
  setRemark: vi.fn(),
}));

vi.mock('@/api/users', () => ({getUserPublicProfile}));
vi.mock('@/api/social', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/social')>();
  return {...actual, getFollowCounts, getRelations, getKnownFollowers, followTarget, unfollowTarget, setRemark};
});
vi.mock('@/api/portfolio', () => ({
  getUserPortfolio: vi.fn().mockResolvedValue({positions: [], partial_errors: []}),
  getUserPortfolioTrades: vi.fn().mockResolvedValue({trades: []}),
  getUserClosedPositions: vi.fn().mockResolvedValue({items: []}),
}));
vi.mock('@/session/storage', () => ({
  useSession: () => ({jwt: 'jwt', user: {identifier: 'self-identifier'}}),
}));

import {UserProfileView} from './UserProfileView';

const profile = {
  identifier: 'target-identifier',
  username: 'alice',
  nickname: 'Alice',
  avatar_url: '',
  bio: 'bio text',
  remark: '',
};

function setup() {
  return render(<UserProfileView identifier="target-identifier" />);
}

beforeEach(() => {
  for (const m of [getUserPublicProfile, getFollowCounts, getRelations, getKnownFollowers, followTarget, unfollowTarget, setRemark]) m.mockReset();
  getUserPublicProfile.mockResolvedValue({data: {...profile}});
  getFollowCounts.mockResolvedValue({data: {following_count: 27, follower_count: 6}});
  getRelations.mockResolvedValue({data: {users: [{identifier: 'target-identifier'}]}});
  getKnownFollowers.mockResolvedValue({data: {entries: [], total: 0}});
});

afterEach(() => cleanup());

describe('UserProfileView 客态头部', () => {
  it('渲染展示名回退 remark → nickname → @username，并显示关注计数', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    expect(screen.getByText('@alice')).toBeTruthy();
    expect(screen.getByText('bio text')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/27/)).toBeTruthy());
    expect(screen.getByText(/6/)).toBeTruthy();
    // 未关注：显示 Follow 按钮
    expect(screen.getByRole('button', {name: 'Follow'})).toBeTruthy();
  });

  it('remark 优先于 nickname 展示；已关注显示 Following 与 Follows you 徽标', async () => {
    getUserPublicProfile.mockResolvedValue({data: {...profile, remark: '我起的备注'}});
    getRelations.mockResolvedValue({data: {users: [{identifier: 'target-identifier', following: true, followed_by: true}]}});
    setup();
    await waitFor(() => expect(screen.getByText('我起的备注')).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('button', {name: 'Following'})).toBeTruthy());
    expect(screen.getByText(/Follows you/i)).toBeTruthy();
  });

  it('known-followers total=100 显示 100+（封顶语义）', async () => {
    getKnownFollowers.mockResolvedValue({
      data: {entries: [{user_identifier: 'mid-1'}], total: 100},
    });
    getRelations.mockResolvedValue({
      data: {users: [{identifier: 'target-identifier'}, {identifier: 'mid-1', following: true}]},
    });
    setup();
    await waitFor(() => expect(screen.getByText(/100\+/)).toBeTruthy());
  });

  it('profile 回 200102 渲染「用户不存在」，不是空白页', async () => {
    getUserPublicProfile.mockRejectedValue(Object.assign(new Error('user not found'), {kind: 'business', code: 200102}));
    setup();
    await waitFor(() => expect(screen.getByText(/用户不存在/)).toBeTruthy());
  });

  it('本人视角：不渲染 Follow 按钮，显示编辑资料入口', async () => {
    getUserPublicProfile.mockResolvedValue({data: {...profile, identifier: 'self-identifier'}});
    setup();
    await waitFor(() => expect(screen.getByText(/编辑资料/)).toBeTruthy());
    expect(screen.queryByRole('button', {name: 'Follow'})).toBeNull();
  });

  it('备注编辑：保存调用 setRemark，清除传空串', async () => {
    setRemark.mockResolvedValue({data: {remark: '新备注', changed: true}});
    setup();
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', {name: /备注/}));
    const input = screen.getByPlaceholderText(/64/);
    await userEvent.type(input, '新备注');
    await userEvent.click(screen.getByRole('button', {name: '保存'}));
    await waitFor(() => expect(setRemark).toHaveBeenCalledWith('jwt', 'user', 'target-identifier', '新备注'));
  });
});
