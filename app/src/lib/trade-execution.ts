import type {PrepareTradeReply, TradeIntent, TradeReply} from '@/api/trade';

function normalizedToken(token: string): string {
  return /^0x[0-9a-f]{40}$/i.test(token) ? token.toLowerCase() : token;
}

export function intentFingerprint(intent: TradeIntent): string {
  return JSON.stringify([
    intent.chain,
    intent.side,
    normalizedToken(intent.token),
    intent.amountIn,
    intent.slippageBps,
  ]);
}

export function parseIntentFingerprint(fingerprint: string): TradeIntent | undefined {
  let value: unknown;
  try { value = JSON.parse(fingerprint); } catch { return undefined; }
  if (!Array.isArray(value) || value.length !== 5) return undefined;
  const [chain, side, token, amountIn, slippageBps] = value;
  if (
    typeof chain !== 'string' || !chain || (side !== 'buy' && side !== 'sell') ||
    typeof token !== 'string' || !token || typeof amountIn !== 'string' || !/^\d+$/.test(amountIn) ||
    BigInt(amountIn) <= BigInt(0) || typeof slippageBps !== 'number' || !Number.isInteger(slippageBps) ||
    slippageBps < 1 || slippageBps > 10_000
  ) return undefined;
  return {chain, side, token, amountIn, slippageBps};
}

export function assertPreparedTradeMatches(
  prepared: PrepareTradeReply,
  intent: TradeIntent,
  tradeID: string,
): void {
  if (
    prepared.trade.trade_id !== tradeID || prepared.trade.side !== intent.side ||
    normalizedToken(prepared.trade.token) !== normalizedToken(intent.token)
  ) throw new Error('The prepared trade does not match the confirmed trade intent.');
  if (prepared.trade.amount_in !== undefined && prepared.trade.amount_in !== intent.amountIn) {
    throw new Error('The prepared amount does not match the confirmed trade intent.');
  }
  if (
    prepared.trade.requested_slippage_bps !== undefined &&
    prepared.trade.requested_slippage_bps !== intent.slippageBps
  ) throw new Error('The prepared slippage does not match the confirmed trade intent.');
}

export function outputAmount(trade: TradeReply): string | undefined {
  return trade.amount_out || trade.amount_out_observed || trade.amount_out_quoted || undefined;
}
