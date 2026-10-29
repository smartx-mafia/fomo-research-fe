import type {TradeReply, TradeSide} from '@/api/trade';
import {listDurableRecords, removeDurableRecord, writeDurableRecord} from '@/session/storage';

export type TradeRecoveryMarker = {
  version: 1;
  actorID: string;
  chain: string;
  token: string;
  fingerprint: string;
  tradeID: string;
  side: TradeSide;
};

function normalizedToken(token: string): string {
  return /^0x[0-9a-f]{40}$/i.test(token) ? token.toLowerCase() : token;
}

export function tradeRecoveryStoragePrefix(actorID: string, chain: string, token: string): string {
  return `smartx.trade.recovery.v1.${encodeURIComponent(actorID)}.${encodeURIComponent(chain)}.${encodeURIComponent(normalizedToken(token))}.`;
}

function storageKey(actorID: string, chain: string, token: string, fingerprint: string): string {
  return `${tradeRecoveryStoragePrefix(actorID, chain, token)}${encodeURIComponent(fingerprint)}`;
}

function parseMarker(raw: string, actorID: string, chain: string, token: string): TradeRecoveryMarker {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Trade recovery marker is corrupt.'); }
  if (!value || typeof value !== 'object') throw new Error('Trade recovery marker is corrupt.');
  const row = value as Partial<TradeRecoveryMarker>;
  if (
    row.version !== 1 || row.actorID !== actorID || row.chain !== chain ||
    row.token !== normalizedToken(token) || typeof row.fingerprint !== 'string' || !row.fingerprint ||
    typeof row.tradeID !== 'string' || !row.tradeID || (row.side !== 'buy' && row.side !== 'sell')
  ) throw new Error('Trade recovery marker is corrupt.');
  return row as TradeRecoveryMarker;
}

export function writeTradeRecovery(
  actorID: string,
  chain: string,
  token: string,
  fingerprint: string,
  trade: Pick<TradeReply, 'trade_id' | 'side' | 'token'>,
): boolean {
  if (!actorID || !chain || !token || !fingerprint || !trade.trade_id || (trade.side !== 'buy' && trade.side !== 'sell')) return false;
  const marker: TradeRecoveryMarker = {
    version: 1,
    actorID,
    chain,
    token: normalizedToken(token),
    fingerprint,
    tradeID: trade.trade_id,
    side: trade.side,
  };
  try {
    const prefix = tradeRecoveryStoragePrefix(actorID, chain, token);
    const existing = listDurableRecords(prefix).map(({value}) => parseMarker(value, actorID, chain, token));
    if (existing.some((item) => item.fingerprint !== fingerprint || item.tradeID !== trade.trade_id)) return false;
    const encoded = JSON.stringify(marker);
    const key = storageKey(actorID, chain, token, fingerprint);
    if (!writeDurableRecord(key, encoded)) return false;
    const verified = listDurableRecords(prefix).map(({value}) => parseMarker(value, actorID, chain, token));
    const ownsOnlyMarker = verified.length === 1 && verified[0]?.fingerprint === fingerprint && verified[0]?.tradeID === trade.trade_id;
    if (!ownsOnlyMarker) removeDurableRecord(key);
    return ownsOnlyMarker;
  } catch {
    return false;
  }
}

export function readTradeRecovery(actorID: string, chain: string, token: string): TradeRecoveryMarker | undefined {
  const records = listDurableRecords(tradeRecoveryStoragePrefix(actorID, chain, token));
  if (records.length === 0) return undefined;
  if (records.length !== 1) throw new Error('Multiple unresolved trade recovery markers require reconciliation.');
  return parseMarker(records[0]!.value, actorID, chain, token);
}

export function clearTradeRecovery(actorID: string, chain: string, token: string, fingerprint: string): boolean {
  try {
    return removeDurableRecord(storageKey(actorID, chain, token, fingerprint));
  } catch {
    return false;
  }
}
