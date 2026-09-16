// @vitest-environment jsdom
import React from 'react';
import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('./LeaderboardView', () => ({LeaderboardView: () => <p>原榜单内容</p>}));
vi.mock('./UnifiedLeaderboardView', () => ({UnifiedLeaderboardView: () => <p>新版榜单内容</p>}));
import {LeaderboardTabs} from './LeaderboardTabs';
afterEach(cleanup);
it('keeps the existing board as default and switches to the new subtab', async () => {
  const user = userEvent.setup();
  render(<LeaderboardTabs />);
  expect(screen.getByText('原榜单内容')).toBeTruthy();
  expect(screen.queryByText('新版榜单内容')).toBeNull();
  await user.click(screen.getByRole('tab', {name: '统一榜单'}));
  expect(screen.getByText('新版榜单内容')).toBeTruthy();
  expect(screen.queryByText('原榜单内容')).toBeNull();
  await user.keyboard('{ArrowLeft}');
  expect(screen.getByText('原榜单内容')).toBeTruthy();
});
