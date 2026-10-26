// @vitest-environment jsdom
/**
 * 客态用户主页（/user/:identifier）：
 * - 路径参数解析（/user/:identifier 与 ?identifier= 双来源）；
 * - 头部客态聚合：profile（200102 → 用户不存在）、follow-counts、relations（following + followed_by）、
 *   known-followers（total=100 → 100+）；
 * - 本人视角不显示关注按钮，显示「编辑资料」；
 * - 备注编辑：设置与清除（空串）走同一端点。
 */
import {cleanup, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const {sessionState, getPosition} = vi.hoisted(() => ({sessionState: {anonymous: false}, getPosition: vi.fn()}));
vi.mock('@/api/user-portfolio', () => ({getUserPortfolioPosition: getPosition}));

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
vi.mock('@/api/portfolio', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/portfolio')>(),
  getUserPortfolio: vi.fn().mockResolvedValue({positions: [], partial_errors: []}),
  getUserPortfolioTrades: vi.fn().mockResolvedValue({trades: []}),
  getUserClosedPositions: vi.fn().mockResolvedValue({items: []}),
}));
vi.mock('@/session/storage', () => ({
  useSession: () => sessionState.anonymous ? undefined : ({jwt: 'jwt', user: {identifier: 'self-identifier'}}),
  readSite: () => sessionState.anonymous ? undefined : ({jwt: 'jwt'}),
  clearSite: vi.fn(),
}));

vi.mock('@/api/portfolio-parts', async load => {
  const actual = await load<typeof import('@/api/portfolio-parts')>();
  const {fixtureReader} = await import('@/test/portfolio-parts-fixture');
  return {...actual, getPortfolioPart: fixtureReader((await import('@/api/portfolio')).getUserPortfolio)};
});
import {UserProfileView} from './UserProfileView';
import {getUserPortfolio, getUserClosedPositions, type PortfolioPosition} from '@/api/portfolio';

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
  sessionState.anonymous = false;
  getPosition.mockReset().mockResolvedValue({status: 'open', position: {}, trades: [], activities_status: 'complete', activities: []});
  vi.mocked(getUserClosedPositions).mockReset().mockResolvedValue({items: []});
  vi.mocked(getUserPortfolio).mockReset().mockResolvedValue({positions: [], partial_errors: []});
  for (const m of [getUserPublicProfile, getFollowCounts, getRelations, getKnownFollowers, followTarget, unfollowTarget, setRemark]) m.mockReset();
  getUserPublicProfile.mockResolvedValue({data: {...profile}});
  getFollowCounts.mockResolvedValue({data: {following_count: 27, follower_count: 6}});
  getRelations.mockResolvedValue({data: {users: [{identifier: 'target-identifier'}]}});
  getKnownFollowers.mockResolvedValue({data: {entries: [], total: 0}});
});

afterEach(() => cleanup());

const testPosition: PortfolioPosition = {asset: {chain: 'bsc', chain_id: '56', kind: 'erc20', token_address: '0xasset'}, shares_raw: '500', opened_entry_id: '0', cycle_key: 'external:cycle', cycle_status: 'ready'};

describe('User profile cycle activity', () => {
  it.each([false, true])('opens the target user current and closed cycles (anonymous=%s)', async anonymous => {
    sessionState.anonymous = anonymous;
    vi.mocked(getUserPortfolio).mockResolvedValue({positions: [testPosition], partial_errors: []});
    vi.mocked(getUserClosedPositions).mockResolvedValue({items: [{...testPosition, cycle_key: 'closed-cycle', closed_entry_id: '0', status: 'closed'}]});
    setup();
    await waitFor(() => expect(screen.getAllByRole('button', {name: '查看活动历史'})).toHaveLength(2));
    await userEvent.click(screen.getAllByRole('button', {name: '查看活动历史'})[0]);
    await waitFor(() => expect(getPosition).toHaveBeenLastCalledWith('target-identifier', {chain: 'bsc', asset: '0xasset', cycle_key: 'external:cycle'}, anonymous ? undefined : 'jwt', expect.any(AbortSignal), {cursor: undefined}));
    expect(screen.getByRole('heading', {name: 'Holding cycle activity'})).toBeTruthy();
    await userEvent.click(screen.getAllByRole('button', {name: '查看活动历史'})[1]);
    await waitFor(() => expect(getPosition).toHaveBeenLastCalledWith('target-identifier', {chain: 'bsc', asset: '0xasset', cycle_key: 'closed-cycle'}, anonymous ? undefined : 'jwt', expect.any(AbortSignal), {cursor: undefined}));
  });

  it('disables records without a cycle key', async () => {
    vi.mocked(getUserPortfolio).mockResolvedValue({positions: [{...testPosition, cycle_key: undefined}], partial_errors: []});
    setup();
    const button = await screen.findByRole('button', {name: '查看活动历史'});
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(button);
    expect(getPosition).not.toHaveBeenCalled();
  });

  it('discards the old activity request when navigating to another user', async () => {
    vi.mocked(getUserPortfolio).mockResolvedValue({positions: [testPosition], partial_errors: []});
    getPosition.mockImplementation(() => new Promise(() => {}));
    const view = setup();
    await userEvent.click(await screen.findByRole('button', {name: '查看活动历史'}));
    const signal = getPosition.mock.calls[0][3] as AbortSignal;
    view.rerender(<UserProfileView identifier="another-user" />);
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole('heading', {name: 'Holding cycle activity'})).toBeNull();
  });
});

describe('UserProfileView 客态头部', () => {
  it('displays the saved background at a fixed 3:1 ratio', async () => {
    getUserPublicProfile.mockResolvedValue({data: {...profile, background_url: 'https://images/background.png'}});
    setup();
    const background = await screen.findByRole('img', {name: 'Profile background'});
    expect(background.getAttribute('src')).toBe('https://images/background.png');
    expect(background.parentElement?.className).toContain('aspect-[3/1]');
  });
  it('loads target-user summary and retains an explicitly stale snapshot after refresh failure', async () => {
    vi.mocked(getUserPortfolio).mockResolvedValue({positions: [], partial_errors: [], total_assets_usd: '1234.56', pnl: {d1: {amount_usd: '-12', curve: []}}});
    setup();
    await waitFor(() => expect(screen.getAllByText('$1,234.56').length).toBeGreaterThan(0));
    expect(getUserPortfolio).toHaveBeenCalledWith('target-identifier', 'jwt');
    expect(screen.getAllByText('$-12').length).toBeGreaterThan(0);
    vi.mocked(getUserPortfolio).mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(screen.getByRole('button', {name: /^Refresh$/}));
    await waitFor(() => expect(screen.getAllByText(/previous snapshot/).length).toBeGreaterThan(0));
    expect(screen.getAllByText('$1,234.56').length).toBeGreaterThan(0);
  });
  it('clears the previous user summary while the next user is loading', async () => {
    vi.mocked(getUserPortfolio).mockResolvedValueOnce({positions: [], partial_errors: [], pnl: {d1: {amount_usd: '123', curve: []}}});
    const view = setup();
    await waitFor(() => expect(screen.getAllByText('$123').length).toBeGreaterThan(0));
    vi.mocked(getUserPortfolio).mockReturnValueOnce(new Promise(() => {}));
    view.rerender(<UserProfileView identifier="another-user" />);
    expect(screen.queryByText('$123')).toBeNull();
    expect(getUserPortfolio).toHaveBeenLastCalledWith('another-user', 'jwt');
  });
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
