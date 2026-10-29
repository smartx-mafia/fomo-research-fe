// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {SWRConfig} from 'swr';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {RiskBanner, RiskDialog, TokenRiskBanner} from './TokenRisk';
import {normalizeRiskAssessment, riskTradeAction} from '@/lib/risk-assessment';
import {normalizeTokenRisk} from '@/lib/token-risk';

const {getMock} = vi.hoisted(() => ({getMock: vi.fn()}));
vi.mock('@/api/token-risk', () => ({getTokenRisk: getMock}));
const NOW = 1_789_000_000_000;
beforeEach(() => {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
  vi.setSystemTime(NOW);
  getMock.mockReset();
});
afterEach(() => {cleanup(); vi.useRealTimers();});

it('cached R1 survives an RPC failure before its deadline, then becomes gray locally with no extra RPC', async () => {
  getMock.mockResolvedValueOnce({chain: 'base', address: '0xabc', risk: normalizeTokenRisk({assessment: {
    mode: 'enforce', grade: 1, checks_complete: true, valid_until_ms: String(NOW + 60_000), buy_action: 'allow',
  }})}).mockRejectedValue(new Error('offline'));
  const cache = new Map();
  await act(async () => {render(<SWRConfig value={{provider: () => cache}}><TokenRiskBanner chain="base" address="0xabc" /></SWRConfig>);});
  expect(getMock).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button')).toBeNull();
  await act(async () => {await vi.advanceTimersByTimeAsync(30_001);});
  expect(getMock).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button')).toBeNull();
  await act(async () => {await vi.advanceTimersByTimeAsync(29_999);});
  expect(screen.getByRole('button', {name: 'Risk data unavailable. View risk details'}).className).toContain('text-muted');
  expect(getMock).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).not.toContain(String(NOW + 60_000));
});

it('a legacy complete snapshot without a deadline becomes incomplete on refresh error', () => {
  const risk = normalizeRiskAssessment({grade: 1, checks_complete: true});
  const {rerender} = render(<RiskBanner risk={risk} />);
  expect(screen.queryByRole('button')).toBeNull();
  rerender(<RiskBanner risk={risk} refreshFailed />);
  expect(screen.getByRole('button', {name: 'Risk data unavailable. View risk details'})).toBeDefined();
  expect(risk.checksComplete).toBe(true); // Presentation does not rewrite backend facts.
});

it('R4 expiry shows a check-state card while preserving items, grade, opaque confirmation and the explicit action', async () => {
  const risk = normalizeRiskAssessment({mode: 'enforce', grade: 4, checks_complete: true, valid_until_ms: String(NOW + 60_000), confirmation_version: 'sameHash:123', buy_action: 'confirm', items: [{code: 'goplus_mintable', grade: 4, display_source: 'goplus'}]});
  const before = JSON.stringify(risk);
  const confirm = vi.fn();
  render(<RiskDialog risk={risk} open refreshFailed onClose={vi.fn()} onConfirm={confirm} />);
  expect(screen.queryByRole('status')).toBeNull();
  await act(async () => {await vi.advanceTimersByTimeAsync(60_000);});
  expect(screen.getByRole('status').textContent).toContain('Risk checks unavailable');
  expect(screen.getByText('Additional tokens can be minted')).toBeDefined();
  expect(JSON.stringify(risk)).toBe(before);
  expect(risk.confirmationVersion).toBe('sameHash:123');
  expect(riskTradeAction(risk, 'buy')).toBe('confirm');
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', {name: /Continue buy/}));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).not.toContain(String(NOW + 60_000));
  expect(getMock).not.toHaveBeenCalled();
});

it.each([2, 3, 5])('keeps known R%s and shows expired-check state, without weakening its Buy action', async (grade) => {
  const risk = normalizeRiskAssessment({mode: 'enforce', grade, checks_complete: true, valid_until_ms: String(NOW + 10), buy_action: grade === 5 ? 'block' : 'allow', items: [{code: 'goplus_transfer_hook', grade}]});
  const original = JSON.stringify(risk);
  render(<RiskBanner risk={risk} />);
  await act(async () => {await vi.advanceTimersByTimeAsync(10);});
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByRole('status').textContent).toContain('Known risks remain listed');
  expect(JSON.stringify(risk)).toBe(original);
  expect(riskTradeAction(risk, 'buy')).toBe(grade === 5 ? 'block' : 'allow');
  expect(riskTradeAction(risk, 'sell')).toBe('allow');
});
