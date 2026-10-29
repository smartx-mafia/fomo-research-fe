// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {RiskBanner, RiskDetails, RiskDialog} from './TokenRisk';
import {normalizeRiskAssessment} from '@/lib/risk-assessment';
afterEach(cleanup);
it('hides complete R1 and shows gray unknown versus red R5', () => {
  const {rerender, container} = render(<RiskBanner risk={normalizeRiskAssessment({grade: 1, checks_complete: true})} />);
  expect(container.textContent).toBe('');
  rerender(<RiskBanner risk={normalizeRiskAssessment({grade: 0})} />);
  expect(screen.getByRole('button').className).toContain('text-muted');
  rerender(<RiskBanner risk={normalizeRiskAssessment({grade: 5, items: [{code: 'goplus_honeypot'}]})} />);
  expect(screen.getByRole('button').className).toContain('text-red-400');
  expect(screen.getByRole('button').textContent).toContain('Honeypot detected');
  expect(screen.getByRole('button').textContent).not.toContain('1 risk');
});
it('counts deduplicated items, groups GoPlus before Codex and rejects invalid params without HTML or timestamps', () => {
  const raw = {grade: 4, items: [{code: 'codex_minimum_liquidity', display_source: 'codex'}, {code: 'goplus_buy_tax', display_source: 'goplus', params: {rate: '<img src=x onerror=alert(1)>'}, evidence: [{observed_at_ms: '1789000000000'}]}, {code: 'codex_minimum_liquidity', display_source: 'codex'}]};
  const {container} = render(<RiskBanner risk={normalizeRiskAssessment(raw)} />);
  fireEvent.click(screen.getByRole('button', {name: /High risk · 2/}));
  expect(screen.getAllByRole('heading', {level: 3}).map((node) => node.textContent)).toEqual(['GoPlus', 'Codex']);
  expect(screen.queryByText('<img src=x onerror=alert(1)>')).toBeNull();
  expect(screen.queryByText('Rate:')).toBeNull();
  expect(document.querySelector('img')).toBeNull();
  expect(document.body.textContent).not.toContain('1789000000000');
  expect(container.textContent).not.toContain('Source:');
});
it('displays only fixed labels for validated rate and creator count, including exact large counts', () => {
  const risk = normalizeRiskAssessment({items: [
    {code: 'goplus_buy_tax', params: {rate: '3.8800', 'provider label': 'provider message', count: '7'}},
    {code: 'goplus_honeypot_with_same_creator', params: {count: '9007199254740993123456789', rate: '7'}},
  ]});
  const {container} = render(<RiskDetails risk={risk} />);
  expect(screen.getByText('Buy tax (3.8800%)')).toBeDefined();
  expect(screen.getByText('3.8800%')).toBeDefined();
  expect(screen.getByText('Related honeypots:')).toBeDefined();
  expect(screen.getByText('9007199254740993123456789')).toBeDefined();
  expect(container.textContent).not.toContain('provider');
  expect(screen.queryByText('7')).toBeNull();
});
it('direct component callers cannot bypass parameter validation or expose unknown labels', () => {
  const risk = normalizeRiskAssessment({items: [{code: 'goplus_buy_tax'}]});
  risk.items[0].params = {rate: '<img src=x onerror=alert(1)>', 'untrusted label': 'untrusted value'};
  const {container} = render(<RiskDetails risk={risk} />);
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('dl')).toBeNull();
  expect(container.textContent).not.toContain('untrusted');
  expect(container.textContent).not.toContain('<img');
});
it('uses a Source footer for one source', () => {
  render(<RiskDetails risk={normalizeRiskAssessment({items: [{code: 'goplus_mintable', display_source: 'goplus'}]})} />);
  expect(screen.getByText('Source: GoPlus')).toBeDefined();
  expect(screen.queryByRole('heading')).toBeNull();
});
it.each([[2, 'Token notice'], [3, 'Risk warning'], [4, 'High risk'], [5, 'High risk · Buying unavailable']] as const)('uses grade %s copy in a multi-item banner and dialog', (grade, title) => {
  render(<RiskBanner risk={normalizeRiskAssessment({mode: 'enforce', grade, items: [{code: 'goplus_mintable'}, {code: 'goplus_proxy'}]})} />);
  fireEvent.click(screen.getByRole('button', {name: `${title} · 2. View risk details`}));
  expect(screen.getByRole('heading', {level: 2}).textContent).toBe(title);
  if (grade === 5) {
    expect(screen.getByRole('dialog').textContent).toContain('This buy restriction does not apply to selling');
    expect(screen.queryByRole('button', {name: /Continue buy/})).toBeNull();
  }
});
it('unknown has exact gray copy and no empty list or source placeholder or trading promise', () => {
  render(<RiskBanner risk={normalizeRiskAssessment({grade: 0})} />);
  fireEvent.click(screen.getByRole('button', {name: 'Risk data unavailable. View risk details'}));
  expect(screen.getByRole('heading', {level: 2}).textContent).toBe('Risk data unavailable');
  expect(screen.queryByRole('list')).toBeNull();
  expect(screen.queryByText(/Source:/)).toBeNull();
  expect(screen.queryByText(/You can still buy or sell/)).toBeNull();
  expect(screen.getByRole('dialog').textContent).toContain('Ordinary transaction checks still apply.');
});
it('long lists scroll only the body, with header and actions outside it and a mobile bottom sheet', () => {
  const risk = normalizeRiskAssessment({mode: 'enforce', grade: 4, confirmation_version: 'hash:1', items: Array.from({length: 60}, (_, index) => ({code: `risk-${index}`, grade: 4}))});
  render(<RiskDialog risk={risk} open onClose={vi.fn()} onConfirm={vi.fn()} />);
  const dialog = screen.getByRole('dialog');
  const body = screen.getByTestId('risk-dialog-body');
  expect(body.querySelectorAll('li')).toHaveLength(60);
  expect(body.className).toContain('overflow-y-auto');
  expect(dialog.className).not.toContain('overflow-y-auto');
  expect(dialog.className).toContain('max-h-[85vh]');
  expect(dialog.className).toContain('bottom-0');
  expect(body.contains(screen.getByTestId('risk-dialog-header'))).toBe(false);
  expect(body.contains(screen.getByTestId('risk-dialog-actions'))).toBe(false);
  expect(screen.getByTestId('risk-dialog-actions').className).toContain('shrink-0');
});
it('an R5 upgrade replaces an open R4 dialog and cannot invoke the retained confirmation callback', () => {
  const confirm = vi.fn();
  const {rerender} = render(<RiskDialog risk={normalizeRiskAssessment({mode: 'enforce', grade: 4, confirmation_version: 'hash:1', items: [{code: 'goplus_mintable'}]})} open onClose={vi.fn()} onConfirm={confirm} />);
  expect(screen.getByRole('button', {name: /Continue buy/})).toBeDefined();
  rerender(<RiskDialog risk={normalizeRiskAssessment({mode: 'enforce', grade: 5, buy_action: 'unavailable', items: [{code: 'goplus_honeypot'}]})} open onClose={vi.fn()} onConfirm={confirm} />);
  expect(screen.getByRole('heading', {level: 2}).textContent).toBe('High risk · Buying unavailable');
  expect(screen.getByText('Honeypot detected')).toBeDefined();
  expect(screen.queryByRole('button', {name: /Continue buy/})).toBeNull();
  expect(confirm).not.toHaveBeenCalled();
});
