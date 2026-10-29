// @vitest-environment jsdom
/**
 * 绑定邀请码卡（invite.md §4 绑定页核心元素）：
 * - @handle / 格式不过本地拒：不发预检、提交置灰；
 * - 预检 ≥300ms 防抖、带 JWT、status=1 之外展示服务端 message；
 * - Skip 只在 defaultBindEnabled === true 时渲染（false / null 都不渲染）；
 * - 提交逐码处置：430111 → onBound(null)；430121 → onWait；420105 倒计时禁用；
 *   430115 隐藏 Skip。
 */
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {bindInvite, checkInviteCode} = vi.hoisted(() => ({
  bindInvite: vi.fn(),
  checkInviteCode: vi.fn(),
}));

vi.mock('@/api/invite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/invite')>();
  return {...actual, bindInvite, checkInviteCode};
});

import {ApiError} from '@/api/envelope';
import {BindInviteCard} from './BindInviteCard';

const onBound = vi.fn();
const onWait = vi.fn();
const setup = (props: Partial<Parameters<typeof BindInviteCard>[0]> = {}) =>
  render(
    <BindInviteCard
      bearer="jwt"
      defaultBindEnabled={false}
      onBound={onBound}
      onWait={onWait}
      {...props}
    />,
  );

beforeEach(() => {
  bindInvite.mockReset();
  checkInviteCode.mockReset();
  checkInviteCode.mockResolvedValue({data: {status: 1, message: ''}});
  onBound.mockReset();
  onWait.mockReset();
});

// vitest 没开 globals，testing-library 的自动 cleanup 不会注册，手动清。
afterEach(() => cleanup());

describe('BindInviteCard 输入与预检', () => {
  it('@handle 本地拒：提示只收公开码，不发预检，提交置灰', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByPlaceholderText(/c4w5dldu/), '@somebody');
    await waitFor(() => {}, {timeout: 50});

    expect(screen.getByText('不接受 @handle —— 只收 8 位公开码')).toBeTruthy();
    expect(checkInviteCode).not.toHaveBeenCalled();
    expect(screen.getByRole('button', {name: '绑定'})).toHaveProperty('disabled', true);
  });

  it('格式通过后防抖预检（带 JWT）：status=1 显示服务端空 message 的兜底文案，大写归一为小写', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByPlaceholderText(/c4w5dldu/), 'C4W5DLDU');
    await waitFor(() => {}, {timeout: 50});

    await waitFor(() => expect(screen.getByText('邀请码可用')).toBeTruthy());
    expect(checkInviteCode).toHaveBeenCalledWith('c4w5dldu', 'jwt');
    expect(screen.getByRole('button', {name: '绑定'})).toHaveProperty('disabled', false);
  });

  it('status≠1 展示服务端 message（可直接展示的英文句子）', async () => {
    checkInviteCode.mockResolvedValue({data: {status: 3, message: 'You cannot use your own invite code.'}});
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByPlaceholderText(/c4w5dldu/), 'zzzz9999');
    await waitFor(() => expect(screen.getByText('You cannot use your own invite code.')).toBeTruthy());
  });
});

describe('BindInviteCard Skip 门控', () => {
  it('Skip 仅在 defaultBindEnabled=true 时渲染；false / 未判定（null）都不渲染', () => {
    const yes = setup({defaultBindEnabled: true});
    expect(screen.getByRole('button', {name: '跳过'})).toBeTruthy();
    yes.unmount();

    const no = setup({defaultBindEnabled: false});
    expect(screen.queryByRole('button', {name: '跳过'})).toBeNull();
    no.unmount();

    const unknown = setup({defaultBindEnabled: null});
    expect(screen.queryByRole('button', {name: '跳过'})).toBeNull();
    unknown.unmount();
  });
});

describe('BindInviteCard 提交逐码处置（invite.md §4.4）', () => {
  it('200：回包是邀请页数据，原样交给 onBound', async () => {
    bindInvite.mockResolvedValue({data: {invite_code: 'zkp2etwm', invitee_count: 0}});
    const user = userEvent.setup();
    setup({initialCode: 'c4w5dldu'});
    await user.click(screen.getByRole('button', {name: '绑定'}));
    await waitFor(() => expect(onBound).toHaveBeenCalledWith({invite_code: 'zkp2etwm', invitee_count: 0}));
    expect(bindInvite).toHaveBeenCalledWith('jwt', 'c4w5dldu');
  });

  it('430111（并发已绑好）：不展示错误，onBound(null) 让父组件回 /status 重判', async () => {
    bindInvite.mockRejectedValue(new ApiError('business', 430111, 'already bound', 'BIZ_INVITE_ALREADY_BOUND'));
    const user = userEvent.setup();
    setup({initialCode: 'c4w5dldu'});
    await user.click(screen.getByRole('button', {name: '绑定'}));
    await waitFor(() => expect(onBound).toHaveBeenCalledWith(null));
    expect(screen.queryByText(/already bound/)).toBeNull();
  });

  it('430121（窗口没开）：转 onWait，不留在本卡报错', async () => {
    bindInvite.mockRejectedValue(new ApiError('business', 430121, 'not open yet', 'BIZ_INVITE_NOT_OPEN_YET'));
    const user = userEvent.setup();
    setup({initialCode: 'c4w5dldu'});
    await user.click(screen.getByRole('button', {name: '绑定'}));
    await waitFor(() => expect(onWait).toHaveBeenCalled());
  });

  it('430115：隐藏 Skip 并要求输入码', async () => {
    bindInvite.mockRejectedValue(new ApiError('business', 430115, 'An invite code is required to continue.', 'BIZ_INVITE_CODE_REQUIRED'));
    const user = userEvent.setup();
    setup({defaultBindEnabled: true});
    await user.click(screen.getByRole('button', {name: '跳过'}));
    await waitFor(() => expect(screen.getByText(/An invite code is required/)).toBeTruthy());
    expect(screen.queryByRole('button', {name: '跳过'})).toBeNull();
  });

  it('200108（码不存在）：输入框下报错，不触发 onBound / onWait', async () => {
    bindInvite.mockRejectedValue(new ApiError('business', 200108, 'does not exist or cannot be used', 'BIZ_INVITE_CODE_NOT_FOUND'));
    const user = userEvent.setup();
    setup({initialCode: 'zzzzzzzz'});
    await user.click(screen.getByRole('button', {name: '绑定'}));
    await waitFor(() => expect(screen.getByText(/does not exist or cannot be used/)).toBeTruthy());
    expect(onBound).not.toHaveBeenCalled();
    expect(onWait).not.toHaveBeenCalled();
  });

  it('420105（试码超限）：按 metadata.retry_after_seconds 倒计时，期间禁用提交', async () => {
    bindInvite.mockRejectedValue(
      new ApiError('business', 420105, 'Too many attempts', 'BIZ_INVITE_ATTEMPT_LIMITED', undefined, undefined, undefined, {
        retry_after_seconds: '90',
      }),
    );
    const user = userEvent.setup();
    setup({initialCode: 'c4w5dldu'});
    await user.click(screen.getByRole('button', {name: '绑定'}));
    await waitFor(() => expect(screen.getByText(/90s 后可重试/)).toBeTruthy());
    expect(screen.getByRole('button', {name: /90s 后可重试/})).toHaveProperty('disabled', true);
  });
});
