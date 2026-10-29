'use client';

import dynamic from 'next/dynamic';

const Console = process.env.NEXT_PUBLIC_ENABLE_HARNESS === 'true'
  ? dynamic(() => import('@/features/token-risk/TokenRiskConsole'), {
      ssr: false,
      loading: () => <div className="grid min-h-screen place-items-center bg-[#080b0a] text-sm text-emerald-100/50">正在加载风控台…</div>,
    })
  : () => null;

export function TokenRiskClient() {
  return <Console />;
}
