import {describe, expect, it} from 'vitest';

import {FastSwapApiError} from './api';
import {decideCreateRecovery} from './idempotency';

describe('Fast Swap recovery_action', () => {
  it('changes only the HTTP key when the old key is exhausted', () => {
    const error = new FastSwapApiError('business', 420606, 'used', 'FASTSWAP_IDEMPOTENCY_CONFLICT', 'trace', {retryable: 'false', recovery_action: 'new_idempotency_key'});
    expect(decideCreateRecovery(error)).toEqual({kind: 'retry_new_key'});
  });

  it('retries the same request only when retryable and delay are both explicit', () => {
    expect(decideCreateRecovery(new FastSwapApiError('business', 420606, 'flying', undefined, undefined, {retryable: 'true', retry_after_ms: '1500', recovery_action: 'retry_same_request'}))).toEqual({kind: 'retry_same_key', delayMS: 1500});
    expect(decideCreateRecovery(new FastSwapApiError('business', 420606, 'no delay', undefined, undefined, {retryable: 'true', recovery_action: 'retry_same_request'}))).toEqual({kind: 'do_not_retry'});
    expect(decideCreateRecovery(new FastSwapApiError('business', 420606, 'final', undefined, undefined, {retryable: 'false', retry_after_ms: '1500', recovery_action: 'retry_same_request'}))).toEqual({kind: 'do_not_retry'});
  });

  it('fails closed to get_snapshot for unknown actions', () => {
    const error = new FastSwapApiError('business', 499999, 'future', undefined, undefined, {recovery_action: 'future_action'});
    expect(error.recoveryAction).toBe('get_snapshot');
    expect(decideCreateRecovery(error)).toEqual({kind: 'get_snapshot', relatedSwapID: undefined});
  });
});
