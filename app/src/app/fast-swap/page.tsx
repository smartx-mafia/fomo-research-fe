import {Suspense} from 'react';

import FastSwapPage from '@/features/fast-swap/FastSwapPage';

export default function Page() {
  return <Suspense fallback={<div className="flex min-h-[60vh] items-center justify-center text-sm text-muted">Loading Fast Swap…</div>}><FastSwapPage /></Suspense>;
}
