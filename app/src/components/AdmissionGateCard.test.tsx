// @vitest-environment jsdom
/**
 * 准入门卡的输入行为（invite.md §1 / §3.4）：
 * - @handle 一律本地拒（服务端回 100124/430116，不查库）；
 * - 格式不过不发预检、提交按钮置灰；
 * - 预检 ≥300ms 防抖，只有本地格式通过后发；
 * - 跳过按钮只在邀请码 + 后端开默认绑定时出现。
 */
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {checkInviteCode, getInviteDefault} = vi.hoisted(() => ({
  checkInviteCode: vi.fn(),
  getInviteDefault: vi.fn(),
}));

vi.mock('@/api/invite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/invite')>();
  return {...actual, checkInviteCode, getInviteDefault};
});

import {AdmissionGateCard} from './AdmissionGateCard';

const nop = () => {};
const setup = (props: Partial<Parameters<typeof AdmissionGateCard>[0]> = {}) =>
  render(
    <AdmissionGateCard
      kind="invite"
      reason="后端要求邀请码"
      busy={false}
      onSubmit={nop}
      onSkip={nop}
      {...props}
    />,
  );

beforeEach(() => {
  checkInviteCode.mockReset();
  getInviteDefault.mockReset();
  getInviteDefault.mockResolvedValue({data: {enabled: false}});
});

// vitest 没开 globals，testing-library 的自动 cleanup 不会注册，手动清。
afterEach(() => cleanup());

describe('AdmissionGateCard（邀请码）', () => {
  it('@handle 本地拒：提示只收公开码，不发预检，提交置灰', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByPlaceholderText(/c4w5dldu/), '@somebody');
    await waitFor(() => {}, {timeout: 50}); // 等一拍让 React 提交状态

    expect(screen.getByText('不接受 @handle —— 只收 8 位公开码')).toBeTruthy();
    expect(checkInviteCode).not.toHaveBeenCalled();
    expect(screen.getByRole('button', {name: '带邀请码登录'})).toHaveProperty('disabled', true);
  });

  it('位数不对：格式错误提示，提交置灰', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByPlaceholderText(/c4w5dldu/), 'abc');
    await waitFor(() => {}, {timeout: 50}); // 等一拍让 React 提交状态

    expect(screen.getByText('格式不对：需要 8位小写字母数字')).toBeTruthy();
    expect(screen.getByRole('button', {name: '带邀请码登录'})).toHaveProperty('disabled', true);
  });

  it('格式通过后防抖预检：status=1 显示可用，大写输入归一为小写', async () => {
    checkInviteCode.mockResolvedValue({data: {status: 1}});
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByPlaceholderText(/c4w5dldu/), 'C4W5DLDU');
    await waitFor(() => {}, {timeout: 50}); // 等一拍让 React 提交状态

    await waitFor(() => expect(screen.getByText('邀请码可用')).toBeTruthy());
    expect(checkInviteCode).toHaveBeenCalledWith('c4w5dldu');
    expect(screen.getByRole('button', {name: '带邀请码登录'})).toHaveProperty('disabled', false);
  });

  it('预检 status=2 显示不存在/不可用文案', async () => {
    checkInviteCode.mockResolvedValue({data: {status: 2}});
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByPlaceholderText(/c4w5dldu/), 'zzzz9999');
    await waitFor(() => {}, {timeout: 50}); // 等一拍让 React 提交状态

    await waitFor(() => expect(screen.getByText('邀请码不存在，请核对拼写')).toBeTruthy());
  });

  it('跳过按钮：后端开默认绑定时出现，否则不出现', async () => {
    getInviteDefault.mockResolvedValue({data: {enabled: true, invite_code: 'h1g51im1'}});
    const first = setup();
    await waitFor(() => expect(screen.getByRole('button', {name: '跳过'})).toBeTruthy());
    first.unmount();

    getInviteDefault.mockResolvedValue({data: {enabled: false}});
    setup();
    await waitFor(() => expect(screen.queryByRole('button', {name: '跳过'})).toBeNull());
  });
});

describe('AdmissionGateCard（入场码）', () => {
  it('15 位格式不过、16 位可提交，且不发预检', async () => {
    const user = userEvent.setup();
    setup({kind: 'entry', onSkip: undefined});
    const input = screen.getByPlaceholderText('16 位入场码');
    await user.type(input, 'a'.repeat(15));
    await waitFor(() => {}, {timeout: 50}); // 等一拍让 React 提交状态
    expect(screen.getByText('格式不对：需要 16位小写字母数字')).toBeTruthy();
    expect(screen.getByRole('button', {name: '带入场码登录'})).toHaveProperty('disabled', true);

    await user.type(input, 'a');
    await waitFor(() => {}, {timeout: 50}); // 等一拍让 React 提交状态
    expect(screen.queryByText(/格式不对/)).toBeNull();
    expect(screen.getByRole('button', {name: '带入场码登录'})).toHaveProperty('disabled', false);
    expect(checkInviteCode).not.toHaveBeenCalled(); // 预检只属于邀请码卡
  });
});
