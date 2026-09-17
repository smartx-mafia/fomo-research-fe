import {FastSwapApiError} from './api';

export type CreateRecoveryDecision =
  | {kind: 'retry_same_key'; delayMS: number}
  | {kind: 'retry_new_key'}
  | {kind: 'get_snapshot'; relatedSwapID?: string}
  | {kind: 'change_input'}
  | {kind: 'contact_support'}
  | {kind: 'do_not_retry'}
  | {kind: 'retain_unknown'};

/** Recovery is driven by metadata, never by the six-digit code. */
export function decideCreateRecovery(error: unknown): CreateRecoveryDecision {
  if (!(error instanceof FastSwapApiError) || error.kind !== 'business') return {kind: 'retain_unknown'};
  switch (error.recoveryAction) {
    case 'new_idempotency_key':
      return {kind: 'retry_new_key'};
    case 'retry_same_request':
      return error.retryable && error.retryAfterMS !== undefined
        ? {kind: 'retry_same_key', delayMS: error.retryAfterMS}
        : {kind: 'do_not_retry'};
    case 'get_snapshot':
      return {kind: 'get_snapshot', relatedSwapID: error.relatedSwapID};
    case 'change_input':
    case 'refresh_quote':
      return {kind: 'change_input'};
    case 'contact_support':
      return {kind: 'contact_support'};
  }
}
