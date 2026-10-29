// @vitest-environment jsdom
import React from 'react';
import {cleanup, render} from '@testing-library/react';
import {afterEach, expect, it} from 'vitest';
import {NotificationBadge} from './NotificationBadge';

afterEach(cleanup);
it('uses a solid speech bubble with contrasting lines for opinion events', () => {
  const {container} = render(<NotificationBadge kind="opinion" />);
  expect(container.querySelector('[data-notification-badge="opinion"] path[fill="#00c9e8"]')).toBeTruthy();
  expect(container.querySelector('path[stroke="#101010"]')).toBeTruthy();
});
it('uses horizontal incoming and outgoing arrows', () => {
  const {container} = render(<><NotificationBadge kind="incoming" /><NotificationBadge kind="outgoing" /></>);
  expect(container.querySelector('[data-notification-badge="incoming"] .lucide-arrow-left')).toBeTruthy();
  expect(container.querySelector('[data-notification-badge="outgoing"] .lucide-arrow-right')).toBeTruthy();
});
it('uses filled follow stars and circular trade markers without inventing unknown badges', () => {
  const {container} = render(<><NotificationBadge kind="follow" /><NotificationBadge kind="buy" /><NotificationBadge kind="sell" /><NotificationBadge kind="future" /></>);
  expect(container.querySelector('[data-notification-badge="follow"] svg[fill="currentColor"]')).toBeTruthy();
  for (const kind of ['buy', 'sell']) expect(container.querySelector(`[data-notification-badge="${kind}"] circle`)).toBeTruthy();
  expect(container.querySelector('[data-notification-badge="future"]')).toBe(null);
});
