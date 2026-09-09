import {call} from './envelope';
import type {ProtoTimestamp} from './portfolio';

export type TransferEntry = {
  direction: 1 | 2;
  chain: 'solana';
  asset_symbol: 'USDC';
  asset_address: string;
  asset_decimals: 6;
  amount_raw: string;
  counterparty?: string;
  tx_hash: string;
  occurred_at: ProtoTimestamp;
};

export type TransferPage = {transfers: TransferEntry[]; next_cursor?: string};

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`Transfer history returned an invalid ${field}.`);
  return value;
}

function timestamp(value: unknown): ProtoTimestamp {
  const row = object(value);
  const validNumber = typeof row?.seconds === 'number' && Number.isSafeInteger(row.seconds) && row.seconds > 0;
  const validString = typeof row?.seconds === 'string' && /^\d+$/.test(row.seconds) && BigInt(row.seconds) > BigInt(0);
  if (!row || (!validNumber && !validString) || (row.nanos !== undefined && (typeof row.nanos !== 'number' || !Number.isInteger(row.nanos) || row.nanos < 0 || row.nanos > 999_999_999))) {
    throw new Error('Transfer history returned an invalid occurred_at.');
  }
  return {seconds: row.seconds as number | string, ...(typeof row.nanos === 'number' ? {nanos: row.nanos} : {})};
}

export function normalizeTransferPage(value: unknown): TransferPage {
  const row = object(value);
  if (!row || (row.transfers !== undefined && !Array.isArray(row.transfers))) throw new Error('Transfer history response is invalid.');
  const transfers = (row.transfers as unknown[] | undefined ?? []).map((item) => {
    const transfer = object(item);
    if (
      !transfer || (transfer.direction !== 1 && transfer.direction !== 2) ||
      transfer.chain !== 'solana' || transfer.asset_symbol !== 'USDC' || transfer.asset_decimals !== 6 ||
      typeof transfer.amount_raw !== 'string' || !/^[1-9]\d*$/.test(transfer.amount_raw)
    ) throw new Error('Transfer history returned an invalid transfer entry.');
    if (typeof transfer.counterparty !== 'string') throw new Error('Transfer history returned an invalid counterparty.');
    return {
      direction: transfer.direction,
      chain: transfer.chain,
      asset_symbol: transfer.asset_symbol,
      asset_address: requiredString(transfer.asset_address, 'asset_address'),
      asset_decimals: transfer.asset_decimals,
      amount_raw: transfer.amount_raw,
      counterparty: transfer.counterparty || undefined,
      tx_hash: requiredString(transfer.tx_hash, 'tx_hash'),
      occurred_at: timestamp(transfer.occurred_at),
    } satisfies TransferEntry;
  });
  if (typeof row.next_cursor !== 'string') throw new Error('Transfer history returned an invalid next_cursor.');
  return {transfers, next_cursor: row.next_cursor || undefined};
}

export async function listTransfers(bearer: string, cursor = '', signal?: AbortSignal): Promise<TransferPage> {
  if (cursor.length > 256) throw new Error('Transfer history cursor is too long.');
  const query = new URLSearchParams();
  if (cursor) query.set('cursor', cursor);
  const response = await call<unknown>(`/v1/transfers${query.size ? `?${query}` : ''}`, {bearer, signal});
  return normalizeTransferPage(response.data);
}
