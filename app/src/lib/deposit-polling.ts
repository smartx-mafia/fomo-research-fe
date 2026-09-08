import type {FiatDepositSession} from '@/api/deposit';
import type {PortfolioReply} from '@/api/portfolio';

export const SOLANA_PORTFOLIO_POLL_INTERVAL_MS = 12_000;
export const SOLANA_PORTFOLIO_MAX_ATTEMPTS = 20;
export const FIAT_ORDER_MAX_POLL_ATTEMPTS = 20;

export type SolanaBalanceMonitor = {
  state: 'idle' | 'waiting' | 'checking' | 'changed' | 'timeout' | 'error';
  attempts: number;
  message?: string;
};

const FIAT_POLL_DELAYS_MS = [3_000, 5_000, 10_000] as const;

export function fiatOrderPollDelayMs(attempt: number): number {
  return FIAT_POLL_DELAYS_MS[attempt] ?? 15_000;
}

export function shouldAutoPollFiatOrder(order: FiatDepositSession | undefined): boolean {
  return !!order && (order.next_action === 'wait' || order.next_action === 'mount_checkout') && order.status >= 1 && order.status <= 4;
}

/**
 * Snapshot only the server-approved Solana mints. Undefined means Portfolio is
 * incomplete for this check, so callers must not interpret a missing balance as
 * zero or announce an arrival.
 */
export function solanaAcceptedBalanceSnapshot(
  portfolio: PortfolioReply | undefined,
  acceptedMints: readonly string[],
): string | undefined {
  if (!portfolio || acceptedMints.length === 0) return undefined;
  const accepted = new Set(acceptedMints);
  const incomplete = portfolio.partial_errors.some((error) => {
    if (error.token_address && accepted.has(error.token_address)) return true;
    if (error.chain?.toLowerCase() === 'solana' && !error.token_address) return true;
    return !error.chain && !error.token_address;
  });
  if (incomplete) return undefined;

  const balances = new Map<string, bigint>();
  for (const mint of accepted) balances.set(mint, BigInt(0));
  for (const position of portfolio.positions) {
    if (position.asset.chain.toLowerCase() !== 'solana' || !accepted.has(position.asset.token_address)) continue;
    balances.set(position.asset.token_address, (balances.get(position.asset.token_address) ?? BigInt(0)) + BigInt(position.amount_raw));
  }
  return JSON.stringify([...balances.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([mint, amount]) => [mint, amount.toString()]));
}

export function solanaAcceptedBalanceChanged(baseline: string, next: string | undefined): boolean {
  return next !== undefined && next !== baseline;
}

export async function abortablePollDelay(ms: number, signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {signal.removeEventListener('abort', abort); resolve();}, ms);
    const abort = () => {clearTimeout(timer); reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));};
    signal.addEventListener('abort', abort, {once: true});
  });
}

/** Pause network polling while the page is hidden; resume when it is visible. */
export async function waitForVisibleDocument(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  if (document.visibilityState === 'visible') return;
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      if (document.visibilityState !== 'visible') return;
      cleanup(); resolve();
    };
    const abort = () => {cleanup(); reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));};
    const cleanup = () => {
      document.removeEventListener('visibilitychange', finish);
      signal.removeEventListener('abort', abort);
    };
    document.addEventListener('visibilitychange', finish);
    signal.addEventListener('abort', abort, {once: true});
  });
}
