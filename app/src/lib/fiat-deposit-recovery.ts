import {validFiatAmount} from './deposit';

export type FiatIntent = {idempotencyKey: string; fiatAmount: string; receiptEmail: string};
export type FiatRecovery = {
  version: 1;
  ownerKey: string;
  privyUserID: string;
  phase: 'dispatching' | 'active' | 'unknown';
  intent?: FiatIntent;
  depositID?: string;
  providerOrderID?: string;
};


export function parseFiatRecovery(raw: string | null, ownerKey: string): {record?: FiatRecovery; corrupt: boolean} {
  if (!raw) return {corrupt: false};
  try {
    const row = JSON.parse(raw) as Partial<FiatRecovery>;
    const phase = row.phase;
    if (
      row.version !== 1 || row.ownerKey !== ownerKey ||
      typeof row.privyUserID !== 'string' || !row.privyUserID ||
      (phase !== 'dispatching' && phase !== 'active' && phase !== 'unknown')
    ) return {corrupt: true};
    if (row.depositID !== undefined && (typeof row.depositID !== 'string' || row.depositID === '')) return {corrupt: true};
    if (row.providerOrderID !== undefined && (typeof row.providerOrderID !== 'string' || row.providerOrderID === '')) return {corrupt: true};
    let intent: FiatIntent | undefined;
    if (row.intent !== undefined) {
      const value = row.intent as FiatIntent;
      if (
        typeof value.idempotencyKey !== 'string' || !value.idempotencyKey || value.idempotencyKey.length > 128 ||
        typeof value.fiatAmount !== 'string' || !validFiatAmount(value.fiatAmount) ||
        typeof value.receiptEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.receiptEmail)
      ) return {corrupt: true};
      intent = value;
    }
    if ((phase === 'dispatching' || (phase === 'unknown' && !row.depositID)) && !intent) return {corrupt: true};
    if (phase === 'active' && !row.depositID) return {corrupt: true};
    return {corrupt: false, record: {
      version: 1, ownerKey, privyUserID: row.privyUserID, phase,
      intent, depositID: row.depositID, providerOrderID: row.providerOrderID,
    }};
  } catch {
    return {corrupt: true};
  }
}

export function isFiatTerminal(status: number): boolean {
  return status === 5 || status === 6 || status === 7;
}

export function recoveryTracksDeposit(record: FiatRecovery | undefined, depositID: string): boolean {
  return record?.depositID === depositID;
}
