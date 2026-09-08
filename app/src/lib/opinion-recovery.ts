import {ApiError} from '@/api/envelope';

/**
 * One unpublished opinion intent per POSITION target, kept in sessionStorage
 * until the backend returns a definite answer for it. The target alone scopes
 * the key because every account holds at most one opinion per target.
 */
export type OpinionIntent = {
  targetID: string;
  mode: 'create' | 'edit';
  /** edit only: the opinion being updated. */
  opinionID?: number;
  /** edit only: the concurrent snapshot this edit is based on. */
  baseVersionID?: number;
  body: string;
  /** Empty string means no attachment. */
  xLinkURL: string;
  idempotencyKey: string;
};

export function newOpinionIdempotencyKey(): string {
  return `opinion-${crypto.randomUUID()}`;
}

function storageKey(targetID: string): string {
  return `smartx.opinion.recovery.v1.${targetID}`;
}

function safeID(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Writes and reads back like FiatDepositCard.writeRecovery: a quota-truncated
 * write must not look successful. false means the caller must warn the user
 * that an uncertain result could not be made recoverable.
 */
export function writeOpinionIntent(intent: OpinionIntent): boolean {
  try {
    const key = storageKey(intent.targetID);
    const encoded = JSON.stringify(intent);
    sessionStorage.setItem(key, encoded);
    return sessionStorage.getItem(key) === encoded;
  } catch {
    return false;
  }
}

/** Corrupt, incomplete, or unreadable records all read as null; never throws. */
export function readOpinionIntent(targetID: string): OpinionIntent | null {
  try {
    const raw = sessionStorage.getItem(storageKey(targetID));
    if (!raw) return null;
    const row = JSON.parse(raw) as Partial<OpinionIntent>;
    if (
      typeof row.targetID !== 'string' || !row.targetID ||
      (row.mode !== 'create' && row.mode !== 'edit') ||
      typeof row.body !== 'string' ||
      typeof row.xLinkURL !== 'string' ||
      typeof row.idempotencyKey !== 'string' || !row.idempotencyKey
    ) return null;
    if (row.opinionID !== undefined && !safeID(row.opinionID)) return null;
    if (row.baseVersionID !== undefined && !safeID(row.baseVersionID)) return null;
    if (row.mode === 'edit' && (!safeID(row.opinionID) || !safeID(row.baseVersionID))) return null;
    return {
      targetID: row.targetID,
      mode: row.mode,
      ...(safeID(row.opinionID) ? {opinionID: row.opinionID} : {}),
      ...(safeID(row.baseVersionID) ? {baseVersionID: row.baseVersionID} : {}),
      body: row.body,
      xLinkURL: row.xLinkURL,
      idempotencyKey: row.idempotencyKey,
    };
  } catch {
    return null;
  }
}

export function clearOpinionIntent(targetID: string): void {
  try {
    sessionStorage.removeItem(storageKey(targetID));
  } catch {
    /* storage unavailable means nothing was stored either */
  }
}

const UNCERTAIN_BUSINESS_CODES = new Set([420000, 500097, 500100, 500101]);

/**
 * True when the outcome of a dispatched create/update cannot be known: the
 * request never reached the envelope layer (transport/network), or the backend
 * answered with a fault that may follow an already-applied write (rate limit
 * and social-storage incidents). Deterministic rejections are false, so they
 * clear the intent and a new key is generated for the next attempt.
 */
export function opinionFailureIsUncertain(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.kind === 'transport' || error.kind === 'network') return true;
  return error.kind === 'business' && UNCERTAIN_BUSINESS_CODES.has(error.code);
}
