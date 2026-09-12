// @vitest-environment jsdom
/**
 * 邀请页（invite.md §2 / §3 / §4，2026-09-11 契约）最小回归集：
 * - sourceLabel 分文案（1 / 6 / 7 / 8 / 3 / 4 / 未知值）；
 * - 只按 next_action 分支：bind 渲染共享绑定卡、wait 渲染等待页、
 *   enter 才请求 /info 并展示邀请码与列表；不认识的 next_action 按 wait。
 */
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {getInviteStatus, getInviteInfo, listInvitees} = vi.hoisted(() => ({
  getInviteStatus: vi.fn(),
  getInviteInfo: vi.fn(),
  listInvitees: vi.fn(),
}));

vi.mock('@/api/invite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/invite')>();
  return {...actual, getInviteStatus, getInviteInfo, listInvitees};
});

vi.mock('@/session/storage', () => ({useSession: () => ({jwt: 'jwt-test'})}));

import {InviteView, sourceLabel} from './InviteView';

beforeEach(() => {
  getInviteStatus.mockReset();
  getInviteInfo.mockReset();
  listInvitees.mockReset();
});

// vitest 没开 globals，testing-library 的自动 cleanup 不会注册，手动清。
afterEach(() => cleanup());

describe('sourceLabel（invite.md §3.5 source）', () => {
  it('按 2026-09-11 契约分文案；未知值一律「其它」', () => {
    expect(sourceLabel(1)).toBe('名单导入');
    expect(sourceLabel(6)).toBe('存量回填');
    expect(sourceLabel(7)).toBe('登录后带码绑定');
    expect(sourceLabel(8)).toBe('无码挂默认');
    expect(sourceLabel(3)).toBe('历史值（登录期绑定）');
    expect(sourceLabel(4)).toBe('历史值（登录期绑定）');
    expect(sourceLabel(2)).toBe('其它');
    expect(sourceLabel(42)).toBe('其它');
    expect(sourceLabel(undefined)).toBe('其它');
  });
});

describe('next_action 分支（invite.md §2.2）', () => {
  it('bind：宿主共享绑定卡；/info /list 都不请求', async () => {
    getInviteStatus.mockResolvedValue({
      data: {
        next_action: 'bind',
        default_bind_enabled: true,
        bind_opens_at: 0,
        phase: 'open',
        admitted: false,
        origin: '',
        inviter: {handle: '', avatar_url: '', pending: false},
      },
    });
    render(<InviteView />);
    await waitFor(() => expect(screen.getByText('还差一步：绑定邀请码（准入）')).toBeTruthy());
    expect(screen.queryByText('我的邀请码')).toBeNull();
    expect(getInviteInfo).not.toHaveBeenCalled();
    expect(listInvitees).not.toHaveBeenCalled();
  });

  it('wait：渲染等待页与倒计时；不出现绑定卡', async () => {
    getInviteStatus.mockResolvedValue({
      data: {
        next_action: 'wait',
        bind_opens_at: Math.floor(Date.now() / 1000) + 7200,
        phase: 'exclusive',
        admitted: false,
        origin: '',
      },
    });
    render(<InviteView />);
    await waitFor(() => expect(screen.getByText(/绑定窗口将在约/)).toBeTruthy());
    expect(screen.getByRole('button', {name: '重新判定准入'})).toBeTruthy();
    expect(screen.queryByText('还差一步：绑定邀请码（准入）')).toBeNull();
  });

  it('enter：/info + /list 都请求；quota=0 显示「名额不限」而非「还能邀 0 人」', async () => {
    getInviteStatus.mockResolvedValue({
      data: {
        next_action: 'enter',
        admitted: true,
        origin: 'waitlist',
        phase: 'open',
        inviter: {handle: 'alice', avatar_url: '', pending: false},
      },
    });
    getInviteInfo.mockResolvedValue({
      data: {invite_code: 'zkp2etwm', invitee_count: 2, invitee_quota: 0, level_name: '', admitted_at: 1789118758},
    });
    listInvitees.mockResolvedValue({
      data: {
        items: [
          {handle: 'bob', pending: false, source: 7, bound_at: 1789118760},
          {handle: '', pending: true, source: 1, bound_at: 1789118761},
          {handle: '', pending: false, source: 42, bound_at: 1789118762},
        ],
        next_cursor: '',
      },
    });
    render(<InviteView />);
    await waitFor(() => expect(screen.getByText('zkp2etwm')).toBeTruthy());
    expect(screen.getByText('邀请名额不限')).toBeTruthy();
    expect(screen.queryByText(/还能邀 0 人/)).toBeNull();
    expect(getInviteInfo).toHaveBeenCalled(); // enter 才请求 /info（invite.md §3.4）
    // source 徽章按 2026-09-11 分文案；未知 source=42 归「其它」。
    expect(screen.getByText('登录后带码绑定')).toBeTruthy();
    expect(screen.getByText('名单导入')).toBeTruthy();
    expect(screen.getByText('其它')).toBeTruthy();
  });

  it('不认识的 next_action 按 wait 处理（落在不放行的一侧）', async () => {
    getInviteStatus.mockResolvedValue({data: {next_action: 'phase_v3_gamma', bind_opens_at: 0, admitted: false}});
    render(<InviteView />);
    await waitFor(() => expect(screen.getByRole('button', {name: '重新判定准入'})).toBeTruthy());
    expect(screen.queryByText('还差一步：绑定邀请码（准入）')).toBeNull();
  });
});
