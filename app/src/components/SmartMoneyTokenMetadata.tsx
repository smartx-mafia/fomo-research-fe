import {chainLabel} from '@/lib/format';

export function SmartMoneyTokenMetadata({chain, platform, averageEntry, tradeTime}: {chain?: string; platform?: string; averageEntry?: string; tradeTime?: string}) {
  return <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
    <span title="所在链" className="rounded border border-border px-1.5 py-0.5">{chain === 'sol' ? 'Solana' : chainLabel(chain)}</span>
    <span title="发射台" className="max-w-[180px] truncate rounded border border-border px-1.5 py-0.5">{platform || '发射台 —'}</span>
    {tradeTime !== undefined ? <span title="最近活跃时间" className="whitespace-nowrap">{tradeTime}</span> : null}
    {averageEntry !== undefined ? <span title="平均买入市值" className="whitespace-nowrap font-mono">Avg.entry {averageEntry}</span> : null}
  </div>;
}
