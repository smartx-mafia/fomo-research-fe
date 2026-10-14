import {call} from './envelope';
import type {ProtoTimestamp} from './portfolio';

export type TransferEntry = {
  direction: 1 | 2;
  chain: string;
  asset_symbol: string;
  asset_address: string;
  asset_decimals: number;
  amount_raw: string;
  counterparty?: string;
  tx_hash: string;
  occurred_at: ProtoTimestamp;
  logo?: string;
  record_id?: string;
  kind?: 'deposit' | 'withdrawal';
  status?: 'pending' | 'completed' | 'failed';
};

export type TransferPage = {transfers: TransferEntry[]; next_cursor?: string};

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`Transfer history returned an invalid ${field}.`);
  return value;
}

function optionalHttpURL(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`Transfer history returned an invalid ${field}.`);
  let parsed: URL;
  try {parsed = new URL(value);} catch {throw new Error(`Transfer history returned an invalid ${field}.`);}
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error(`Transfer history returned an invalid ${field}.`);
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
    if (!transfer) throw new Error('Transfer history returned an invalid transfer entry.');
    const business = transfer.kind === 'deposit' || transfer.kind === 'withdrawal';
    if (transfer.kind && !business) throw new Error('Transfer history returned an invalid kind.');
    if (business && (typeof transfer.record_id !== 'string' || !transfer.record_id || !['pending', 'completed', 'failed'].includes(String(transfer.status)))) {
      throw new Error('Transfer history returned an invalid business record.');
    }
    const unsettled = business && transfer.status !== 'completed';
    if (
      (transfer.direction !== 1 && transfer.direction !== 2) ||
      typeof transfer.chain !== 'string' || !transfer.chain || typeof transfer.asset_symbol !== 'string' ||
      !Number.isInteger(transfer.asset_decimals) || Number(transfer.asset_decimals) < 0 || Number(transfer.asset_decimals) > 255 ||
      typeof transfer.amount_raw !== 'string' ||
      (!(unsettled && transfer.amount_raw === '') && !/^[1-9]\d*$/.test(transfer.amount_raw)) ||
      (!business && (transfer.chain !== 'solana' || transfer.asset_symbol !== 'USDC' || transfer.asset_decimals !== 6))
    ) throw new Error('Transfer history returned an invalid transfer entry.');
    if (typeof transfer.tx_hash !== 'string' || (!unsettled && !transfer.tx_hash)) throw new Error('Transfer history returned an invalid tx_hash.');
    if (business && typeof transfer.asset_address !== 'string') throw new Error('Transfer history returned an invalid asset_address.');
    if (typeof transfer.counterparty !== 'string') throw new Error('Transfer history returned an invalid counterparty.');
    return {
      direction: transfer.direction,
      chain: transfer.chain,
      asset_symbol: transfer.asset_symbol,
      asset_address: business ? transfer.asset_address as string : requiredString(transfer.asset_address, 'asset_address'),
      asset_decimals: transfer.asset_decimals as number,
      amount_raw: transfer.amount_raw,
      counterparty: transfer.counterparty || undefined,
      tx_hash: transfer.tx_hash,
      occurred_at: timestamp(transfer.occurred_at),
      logo: optionalHttpURL(transfer.logo, 'logo'),
      ...(business ? {record_id: transfer.record_id as string, kind: transfer.kind as 'deposit' | 'withdrawal', status: transfer.status as 'pending' | 'completed' | 'failed'} : {}),
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
