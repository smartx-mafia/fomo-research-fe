// @vitest-environment jsdom

import {cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import TokenRiskConsole, {ProviderCard, SerializedAuditCard, VolumeRiskMatrix} from './TokenRiskConsole';
import type {RiskAssessment, RiskSourceStatus} from '@/lib/risk-assessment';

const {getSerializedAuditMock, getTokenRiskMock} = vi.hoisted(() => ({getSerializedAuditMock: vi.fn(), getTokenRiskMock: vi.fn()}));
vi.mock('@/api/token-risk', async (original) => ({...await original<typeof import('@/api/token-risk')>(), getTokenRisk: getTokenRiskMock}));
vi.mock('@/api/serialized-audit', () => ({getSerializedAudit: getSerializedAuditMock}));

beforeEach(() => {
  getSerializedAuditMock.mockResolvedValue({state: 'unavailable', reason: 'decompile_disabled', message: 'Closed-source audit disabled.'});
});

afterEach(() => {
  cleanup();
  getSerializedAuditMock.mockReset();
  getTokenRiskMock.mockReset();
});

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
  it('does not present an invalid provider response as a clean report', () => {
    render(<ProviderCard source={{...source, status: 'invalid'}} risk={{...risk, items: []}} />);

    expect(screen.getByText('数据无效')).toBeTruthy();
    expect(screen.getByText('暂无有效检查结果')).toBeTruthy();
    expect(screen.getByText('不能据此判断代币安全')).toBeTruthy();
    expect(screen.queryByText('未报告风险项')).toBeNull();
  });

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

describe('VolumeRiskMatrix', () => {
  it('marks every proposed volume signal as inactive reference material', () => {
    render(<VolumeRiskMatrix />);

    expect(screen.getAllByText('未接入')).toHaveLength(6);
    expect(screen.queryByText('当前生效')).toBeNull();
    expect(screen.getAllByLabelText('候选等级 R3')).toHaveLength(4);
    expect(screen.getAllByLabelText('候选等级 R4')).toHaveLength(2);
    expect(screen.getByText(/不是当前代币的检测结果/)).toBeTruthy();
    expect(screen.getByText(/最终等级仍以后端返回为准/)).toBeTruthy();
  });
});

describe('SerializedAuditCard', () => {
  it('shows provider findings without presenting them as the SmartX decision', () => {
    render(<SerializedAuditCard loading={false} result={{state: 'ready', audit: {
      isSafe: false, isTokenSafe: false, description: 'Owner can mint.', name: 'Risk', symbol: 'RISK',
      address: '0x1111111111111111111111111111111111111111', chain: 'ROBINHOOD', sourceType: 'verified',
      isProxy: false, createdAt: '2026-10-16T00:00:00Z', auditSystemVersion: 'prod-v2',
      vulnerabilities: [{type: 'UnlimitedMinting', impact: 'critical', description: 'Supply is unlimited.', mitigated: false}],
    }}} />);

    expect(screen.getByText('发现合约风险')).toBeTruthy();
    expect(screen.getByText('UnlimitedMinting')).toBeTruthy();
    expect(screen.getByText(/不改变 SmartX 综合等级或交易决策/)).toBeTruthy();
  });
});

describe('TokenRiskConsole', () => {
  it('queries token risk on Robinhood', async () => {
    const user = userEvent.setup();
    const tokenAddress = '0x1111111111111111111111111111111111111111';
    getTokenRiskMock.mockResolvedValue({chain: 'robinhood', address: tokenAddress, risk: {assessment: risk}});
    render(<TokenRiskConsole />);

    expect(getSerializedAuditMock).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByRole('combobox', {name: /网络/}), 'robinhood');
    const address = screen.getByPlaceholderText('输入代币合约地址');
    await user.clear(address);
    await user.type(address, tokenAddress);
    await user.click(screen.getByRole('button', {name: '查询风控'}));

    await waitFor(() => expect(getTokenRiskMock).toHaveBeenLastCalledWith('robinhood', tokenAddress, undefined, expect.any(AbortSignal)));
    await waitFor(() => expect(getSerializedAuditMock).toHaveBeenLastCalledWith('robinhood', tokenAddress, expect.any(AbortSignal)));
  });

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
