'use client';

import {useEffect, useReducer} from 'react';
import {riskChecksReusable, type RiskAssessment} from '@/lib/risk-assessment';

/** Wake at the backend deadline without revalidating SWR or calling any provider. */
export function useRiskCheckState(risk: RiskAssessment | undefined, refreshFailed = false) {
  const [, update] = useReducer((revision: number) => revision + 1, 0);
  const deadline = risk?.validUntilMs;
  useEffect(() => {
    if (!deadline || !/^\d{1,19}$/.test(deadline)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function schedule() {
      clearTimeout(timer);
      const remaining = BigInt(deadline!) - BigInt(Date.now());
      if (remaining > BigInt(0)) timer = setTimeout(tick, Number(remaining > BigInt(2_147_483_647) ? BigInt(2_147_483_647) : remaining));
    }
    function tick() { update(); schedule(); }
    schedule();
    // Recheck after background timer throttling, sleep or a local clock change.
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [deadline]);
  return riskChecksReusable(risk, Date.now(), refreshFailed);
}
