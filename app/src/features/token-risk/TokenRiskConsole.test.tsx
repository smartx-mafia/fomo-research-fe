// @vitest-environment jsdom

import {render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import TokenRiskConsole, {ProviderCard} from './TokenRiskConsole';
import type {RiskAssessment, RiskSourceStatus} from '@/lib/risk-assessment';

const {getTokenRiskMock} = vi.hoisted(() => ({getTokenRiskMock: vi.fn()}));
vi.mock('@/api/token-risk', async (original) => ({...await original<typeof import('@/api/token-risk')>(), getTokenRisk: getTokenRiskMock}));

const source: RiskSourceStatus = {
  source: 'rugcheck', status: 'partial', observedAtMs: null, fetchedAtMs: null,
  validUntilMs: null, reportHash: '', checksComplete: false,
};

const risk = {
  mode: 'enforce', grade: 4, checksComplete: false, validUntilMs: null,
  policyVersion: 'test', decisionVersion: 'decision', confirmationVersion: '',
  checks: [], sources: [source], goplusStatus: '', goplusObservedAtMs: null,
  lastAttemptAtMs: null, recommendationAllowed: false, keywordSearchAllowed: false,
  squareDistributionAllowed: false, buyAction: 'confirm',
  items: Array.from({length: 6}, (_, index) => ({
    code: `risk-${index + 1}`, grade: 4, displaySource: 'rugcheck', title: '', detail: '', params: {}, evidence: [],
  })),
} satisfies RiskAssessment;

describe('ProviderCard', () => {
  it('expands and collapses all provider risk findings', async () => {
    const user = userEvent.setup();
    render(<ProviderCard source={source} risk={risk} />);

    expect(screen.getAllByText('Additional risk flagged')).toHaveLength(4);
    expect(screen.getAllByLabelText('R4 · 高风险')).toHaveLength(4);
    const expand = screen.getByRole('button', {name: /展开其余 2 项/});
    expect(expand.getAttribute('aria-expanded')).toBe('false');

    await user.click(expand);
    expect(screen.getAllByText('Additional risk flagged')).toHaveLength(6);
    expect(screen.getAllByLabelText('R4 · 高风险')).toHaveLength(6);
    const collapse = screen.getByRole('button', {name: /收起风险项/});
    expect(collapse.getAttribute('aria-expanded')).toBe('true');

    await user.click(collapse);
    expect(screen.getAllByText('Additional risk flagged')).toHaveLength(4);
  });
});

describe('TokenRiskConsole', () => {
  it('removes the previous token result while a new query fails', async () => {
    const user = userEvent.setup();
    getTokenRiskMock
      .mockResolvedValueOnce({chain: 'solana', address: 'old-token', risk: {assessment: risk}})
      .mockRejectedValueOnce(new Error('new token unavailable'));
    render(<TokenRiskConsole />);

    await screen.findByText('solana:old-token');
    const address = screen.getByPlaceholderText('输入代币合约地址');
    await user.clear(address);
    await user.type(address, 'new-token');
    await user.click(screen.getByRole('button', {name: '查询风控'}));

    await screen.findByText('new token unavailable');
    await waitFor(() => expect(screen.queryByText('solana:old-token')).toBeNull());
  });
});
