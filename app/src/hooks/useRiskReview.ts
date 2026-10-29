'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import type {RiskAssessment} from '@/lib/risk-assessment';

/** Only a user click resolves true. Closing, unmounting or changing context cancels. */
export function useRiskReview(context: string) {
  const [request, setRequest] = useState<{risk: RiskAssessment; context: string}>();
  const pending = useRef<((accepted: boolean) => void) | undefined>(undefined);
  const finish = useCallback((accepted: boolean) => {
    const resolve = pending.current;
    pending.current = undefined;
    setRequest(undefined);
    resolve?.(accepted);
  }, []);
  useEffect(() => () => { pending.current?.(false); pending.current = undefined; }, [context]);
  const review = useCallback((risk: RiskAssessment) => new Promise<boolean>((resolve) => {
    pending.current?.(false);
    pending.current = resolve;
    setRequest({risk, context});
  }), [context]);
  return {risk: request?.context === context ? request.risk : undefined, review, finish};
}
