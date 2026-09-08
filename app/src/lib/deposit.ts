export function validFiatAmount(value: string): boolean {
  const amount = value.trim();
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(amount)) return false;
  return BigInt(amount.replace('.', '')) > BigInt(0);
}

export function receiptEmailForAuth(linkedAccounts: readonly unknown[], authMethod?: string): string | undefined {
  const wanted = authMethod === 'AUTH_METHOD_EMAIL' ? 'email'
    : authMethod === 'AUTH_METHOD_GOOGLE' ? 'google_oauth'
      : authMethod === 'AUTH_METHOD_APPLE' ? 'apple_oauth' : undefined;
  const candidates: string[] = [];
  for (const value of linkedAccounts) {
    if (!value || typeof value !== 'object') continue;
    const account = value as Record<string, unknown>;
    if (wanted && account.type !== wanted) continue;
    const email = account.type === 'email' ? account.address : account.email;
    if (typeof email === 'string' && email.includes('@')) candidates.push(email.trim().toLowerCase());
  }
  const unique = [...new Set(candidates.filter(Boolean))];
  return unique.length === 1 ? unique[0] : undefined;
}

export function newDepositIdempotencyKey(): string {
  return `deposit-${crypto.randomUUID()}`;
}

export function expiryHasMargin(expiresAt: string | undefined, marginMs = 5_000): boolean {
  if (!expiresAt) return false;
  const value = Date.parse(expiresAt);
  return Number.isFinite(value) && value - Date.now() >= marginMs;
}

const DETERMINISTIC_FIAT_CREATE_CODES = new Set([100114, 400000, 420100, 430107, 430114]);

/** Once Create was dispatched, transport/parse/system failures may hide a provider order and must retain the same intent. */
export function fiatCreateFailureIsUncertain(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  if (error.kind !== 'business') return true;
  if (error.reason === 'BIZ_INVITE_NOT_ADMITTED') return false;
  return !DETERMINISTIC_FIAT_CREATE_CODES.has(error.code);
}
import {ApiError} from '@/api/envelope';
