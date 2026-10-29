// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ApiError} from '@/api/envelope';
import {normalizeRiskAssessment} from '@/lib/risk-assessment';
import {TradePanel} from './TradePanel';

const mocks = vi.hoisted(() => ({
  create: vi.fn(), prepare: vi.fn(), submit: vi.fn(), get: vi.fn(), poll: vi.fn(), preview: vi.fn(), positions: vi.fn(),
  confirm: vi.fn(), refresh: vi.fn(), sign: vi.fn(), state: {risk: undefined as unknown, jwt: 'jwt'}, events: [] as string[],
}));
vi.mock('@/session/storage', () => ({useSession: () => ({jwt: mocks.state.jwt}), clearSite: vi.fn()}));
vi.mock('@/config', () => ({SOLANA_RPC_URL: 'https://rpc.example.test'}));
vi.mock('@privy-io/react-auth', () => ({usePrivy: () => ({ready: true, authenticated: true}), useWallets: () => ({wallets: [{address: 'wallet'}]})}));
vi.mock('@privy-io/react-auth/solana', () => ({useWallets: () => ({wallets: [{address: 'sol-wallet'}]}), useSignTransaction: () => ({signTransaction: vi.fn()})}));
vi.mock('@/hooks/useTokenRisk', () => ({useTokenRisk: () => ({risk: mocks.state.risk, refresh: mocks.refresh})}));
vi.mock('@/api/token-risk', async (original) => ({...await original<typeof import('@/api/token-risk')>(), confirmTokenRisk: mocks.confirm}));
vi.mock('@/api/trade', async (original) => ({
  ...await original<typeof import('@/api/trade')>(), createTrade: mocks.create, prepareTrade: mocks.prepare, submitTrade: mocks.submit,
  getTrade: mocks.get, pollTrade: mocks.poll, previewTrade: mocks.preview, listPositions: mocks.positions,
  listTradeChains: vi.fn(async () => [{chain: 'base', chain_id: 8453, kind: 'evm'}]),
  getTokenInfo: vi.fn(async () => ({chain: 'base', address: 'token', symbol: 'TEST', decimals: 18})),
}));
vi.mock('@/lib/trade-signature', () => ({fromBase64: () => new Uint8Array(), toBase64: () => 'signature', signEvmDigest: mocks.sign}));

const pending = {trade_id: 't-1', side: 'buy', token: 'token', status: 1, lifecycle: 'awaiting_signature'};
const done = {...pending, status: 2, lifecycle: 'confirmed'};
function assessment(grade = 4, version = 'v1', mode = 'enforce') {
  return normalizeRiskAssessment({mode, grade, buy_action: grade === 5 ? 'block' : grade === 4 ? 'confirm' : 'allow', confirmation_version: version, checks_complete: grade > 0, items: grade >= 4 ? [{code: 'goplus_mintable', grade, display_source: 'goplus'}] : []});
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.events.length = 0;
  mocks.state.jwt = 'jwt';
  mocks.state.risk = assessment();
  mocks.refresh.mockImplementation(async () => ({chain: 'base', address: 'token', risk: {assessment: mocks.state.risk}}));
  mocks.confirm.mockImplementation(async () => {mocks.events.push('confirm'); return {chain: 'base', address: 'token', risk: {assessment: mocks.state.risk}};});
  mocks.create.mockImplementation(async () => {mocks.events.push('create'); return pending;});
  mocks.prepare.mockImplementation(async () => {mocks.events.push('prepare'); return {trade: pending, sign_kind: 4, sign_data: '', wallet_address: 'wallet', expires_at: '2099-01-01T00:00:00Z'};});
  mocks.sign.mockImplementation(async () => {mocks.events.push('sign'); return new Uint8Array();});
  mocks.submit.mockImplementation(async () => {mocks.events.push('submit'); return done;});
  mocks.get.mockResolvedValue(pending);
  mocks.poll.mockResolvedValue({trade: done, stop: 'settled'});
  mocks.preview.mockResolvedValue({amount_in: '1000000'});
  mocks.positions.mockRejectedValue(new Error('no position projection'));
});
afterEach(cleanup);
async function mount() {
  const view = render(<TradePanel chain="base" address="token" symbol="TEST" />);
  fireEvent.change(screen.getByRole('textbox', {name: /Amount/}), {target: {value: '1'}});
  await waitFor(() => expect(screen.queryByText('Loading enabled chains…')).toBeNull());
  return view;
}
async function execute(side = 'buy') {
  const button = screen.getByRole('button', {name: `Review ${side}`});
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  fireEvent.click(await screen.findByRole('button', {name: 'Confirm & sign'}));
}
async function accept() {
  fireEvent.click(await screen.findByRole('button', {name: /I understand the risks/}));
}
describe('ordinary Trade risk gates', () => {
  it('requires an explicit modal click before Create, then prepare=false, flow confirmation, prepare/sign/submit exactly once', async () => {
    await mount();
    await execute();
    await screen.findByRole('dialog');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    const button = screen.getByRole('button', {name: /I understand the risks/});
    await act(async () => {button.click(); button.click();});
    await waitFor(() => expect(mocks.poll).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0][3]).toEqual({prepare: false});
    expect(mocks.confirm).toHaveBeenCalledWith('base', 'token', 'jwt', 'meme:t-1', 'v1', expect.any(AbortSignal));
    expect(mocks.events).toEqual(['create', 'confirm', 'prepare', 'sign', 'submit']);
  });
  it('cancelling risk review never creates or acknowledges a trade', async () => {
    await mount(); await execute();
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it.each([0, 1, 2, 3])('grade %s follows the ordinary trade flow', async (grade) => {
    mocks.state.risk = assessment(grade);
    await mount(); await execute();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.create.mock.calls[0][3]).toBeUndefined();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('observe mode R5 cannot block trading', async () => {
    mocks.state.risk = assessment(5, 'v1', 'observe');
    await mount(); await execute();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('R5 Buy explains the block and Sell adds no risk RPC or confirmation gate', async () => {
    mocks.state.risk = assessment(5);
    await mount();
    fireEvent.click(screen.getByRole('button', {name: /Buy unavailable/}));
    expect(screen.getByRole('dialog').textContent).toContain('This buy restriction does not apply to selling');
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: 'Close'}));
    fireEvent.click(screen.getByRole('button', {name: 'sell'}));
    mocks.preview.mockResolvedValue({});
    await execute('sell');
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.create.mock.calls[0][1].side).toBe('sell');
  });
  it('uses the fresh RPC decision instead of the earlier rendered R1', async () => {
    mocks.state.risk = assessment(1);
    mocks.refresh.mockResolvedValue({chain: 'base', address: 'token', risk: {assessment: assessment(5)}});
    await mount(); await execute();
    expect((await screen.findByRole('dialog')).textContent).toContain('Buying unavailable');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('retains an R4 gate when refreshing fails', async () => {
    mocks.refresh.mockRejectedValue(new Error('offline'));
    await mount(); await execute();
    await screen.findByRole('dialog');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('live R5 storage_error replaces an open R4 review and prevents Create, confirmation and signing', async () => {
    const view = await mount(); await execute();
    await screen.findByRole('button', {name: /Continue buy/});
    mocks.state.risk = normalizeRiskAssessment({mode: 'enforce', grade: 5, buy_action: 'unavailable', goplus_status: 'storage_error', items: [{code: 'goplus_honeypot', grade: 5}]});
    view.rerender(<TradePanel chain="base" address="token" symbol="TEST" />);
    expect(screen.getByRole('dialog').textContent).toContain('Honeypot detected');
    expect(screen.getByRole('dialog').textContent).toContain('Buying unavailable');
    expect(screen.queryByRole('button', {name: /Continue buy/})).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: 'Close'}));
    await waitFor(() => expect((screen.getByRole('button', {name: 'sell'}) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', {name: 'sell'}));
    mocks.refresh.mockClear();
    mocks.preview.mockResolvedValue({});
    await execute('sell');
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.create.mock.calls[0][1].side).toBe('sell');
  });
  it('double-clicking ordinary Confirm & sign creates and submits once', async () => {
    mocks.state.risk = assessment(1);
    await mount();
    fireEvent.click(screen.getByRole('button', {name: 'Review buy'}));
    const button = await screen.findByRole('button', {name: 'Confirm & sign'});
    await act(async () => {button.click(); button.click();});
    await waitFor(() => expect(mocks.poll).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it('an added R4 version prompts again on the same flow even without a server rejection', async () => {
    mocks.prepare.mockRejectedValueOnce(new Error('prepare offline'));
    await mount(); await execute(); await accept();
    await screen.findByText('prepare offline');
    mocks.state.risk = assessment(4, 'added-R4');
    await execute();
    await screen.findByRole('dialog');
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    await accept();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.confirm.mock.calls[1][4]).toBe('added-R4');
  });
  it('R4 to R5 to the same R4 with a new epoch cannot revive an old confirmation', async () => {
    mocks.state.risk = assessment(4, 'sameHash:1');
    mocks.prepare.mockRejectedValueOnce(new Error('prepare offline'));
    const view = await mount(); await execute(); await accept();
    await screen.findByText('prepare offline');
    mocks.state.risk = assessment(5, 'blockedHash:2');
    view.rerender(<TradePanel chain="base" address="token" symbol="TEST" />);
    expect(screen.getByRole('button', {name: /Buy unavailable/})).toBeDefined();
    mocks.state.risk = assessment(4, 'sameHash:3');
    view.rerender(<TradePanel chain="base" address="token" symbol="TEST" />);
    await execute(); await screen.findByRole('dialog');
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    await accept();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.confirm.mock.calls[1].slice(3, 5)).toEqual(['meme:t-1', 'sameHash:3']);
  });
  it('stale confirmation replies cannot reach Prepare or signing', async () => {
    mocks.confirm.mockResolvedValue({chain: 'base', address: 'token', risk: {assessment: assessment(4, 'v2')}});
    await mount(); await execute(); await accept();
    await screen.findByText(/The token risks changed/);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it('risk-store failure does not turn into an acknowledgement or a Buy', async () => {
    mocks.confirm.mockRejectedValue(new ApiError('business', 500310, 'store unavailable'));
    await mount(); await execute(); await accept();
    await screen.findByText(/Risk confirmation storage is temporarily unavailable/);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('changing user cancels the open risk modal without confirming', async () => {
    const view = await mount(); await execute();
    await screen.findByRole('dialog');
    mocks.state.jwt = 'other-user-jwt';
    view.rerender(<TradePanel chain="base" address="token" symbol="TEST" />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it.each([430310, 430312])('a mid-Prepare %s needs a fresh user click and reuses the same flow', async (code) => {
    mocks.prepare.mockRejectedValueOnce(new ApiError('business', code, 'risk rejected'));
    await mount(); await execute(); await accept();
    await screen.findByText(/Review.*confirm.*again|Review and confirm the current/);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.submit).not.toHaveBeenCalled();
    mocks.state.risk = assessment(4, 'v2');
    await execute();
    await screen.findByRole('dialog');
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    await accept();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.confirm.mock.calls[1].slice(3, 5)).toEqual(['meme:t-1', 'v2']);
  });
  it('reuses confirmed version on the same flow after an unrelated prepare failure', async () => {
    mocks.prepare.mockRejectedValueOnce(new Error('prepare offline'));
    await mount(); await execute(); await accept();
    await screen.findByText('prepare offline');
    mocks.state.risk = {...assessment(), decisionVersion: 'new-observation', lastAttemptAtMs: '1789000000000', validUntilMs: String(Date.now() - 1)};
    await execute();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it('unknown Submit never automatically re-signs, confirms or submits again', async () => {
    mocks.state.risk = assessment(1);
    mocks.submit.mockRejectedValue(new Error('network timeout'));
    await mount(); await execute();
    await screen.findByText(/Submit returned no final answer/);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect((screen.getByRole('button', {name: 'Review buy'}) as HTMLButtonElement).disabled).toBe(true);
  });
  it('already submitted orders recover normally even when the current risk becomes R5', async () => {
    mocks.state.risk = assessment(1);
    mocks.submit.mockRejectedValue(new Error('network timeout'));
    mocks.get.mockImplementation(async () => {mocks.state.risk = assessment(5); return {...pending, lifecycle: 'submitted'};});
    await mount(); await execute();
    await waitFor(() => expect(mocks.poll).toHaveBeenCalledTimes(1));
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('a definitive Submit risk rejection with recovered pre-submit state requires new confirmation', async () => {
    mocks.submit.mockRejectedValueOnce(new ApiError('business', 430312, 'stale'));
    await mount(); await execute(); await accept();
    await screen.findByText(/The token risks changed/);
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    mocks.state.risk = assessment(4, 'v2');
    await execute(); await screen.findByRole('dialog');
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    await accept();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});
