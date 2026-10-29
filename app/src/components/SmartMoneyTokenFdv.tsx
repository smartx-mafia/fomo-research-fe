'use client';

import useSWR from 'swr';
import {fetchTokenMarket} from '@/lib/market';
import {fmtCompact} from '@/lib/format';

export function SmartMoneyTokenFdv({chain, address}: {chain: string; address?: string}) {
  const marketChain = chain === 'sol' ? 'solana' : chain;
  const marketAddress = marketChain === 'solana' ? address : address?.toLowerCase();
  const market = useSWR(marketAddress ? ['smart-money-token-fdv', marketChain, marketAddress] : null,
    async ([, c, a]) => {
      const data = await fetchTokenMarket(c, a);
      const actualAddress = c === 'solana' ? data.address : data.address.toLowerCase();
      if (data.chain !== c || actualAddress !== a) throw new Error('Token market identity mismatch.');
      return data;
    }, {dedupingInterval: 60_000, shouldRetryOnError: false});
  const value = market.data?.market_cap_diluted;
  const available = value !== undefined && Number.isFinite(value) && value > 0;
  return <span className="whitespace-nowrap font-mono text-[10px] text-muted"
    title={available ? `总供应量对应市值（FDV）：$${value.toLocaleString('en-US', {maximumFractionDigits: 2})}` : market.error ? 'FDV 加载失败' : '总供应量对应市值（FDV）'}>
    {available ? `$${fmtCompact(value)}` : market.isLoading ? '…' : '—'}
  </span>;
}
