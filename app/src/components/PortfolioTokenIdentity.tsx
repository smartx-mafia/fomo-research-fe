'use client';

import {useState} from 'react';
import {shortAddr} from '@/lib/format';

function usableLogo(logo?: string) {
  return logo && /^https?:\/\//i.test(logo) ? logo : undefined;
}

export function PortfolioTokenIdentity({chain, address, symbol, name, logo}: {
  chain: string; address: string; symbol?: string; name?: string; logo?: string;
}) {
  const source = usableLogo(logo);
  const [failed, setFailed] = useState<string>();
  const label = name ?? symbol ?? shortAddr(address);
  return <div className="flex min-w-[150px] items-center gap-2.5">
    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-xs font-semibold text-muted">
      {source && failed !== source
        ? <img src={source} alt="" className="h-full w-full object-cover" onError={() => setFailed(source)} />
        : <span aria-hidden="true">{symbol?.trim().slice(0, 1).toUpperCase() || '?'}</span>}
    </div>
    <div className="min-w-0">
      <a href={`/token/${encodeURIComponent(chain)}/${encodeURIComponent(address)}`} className="block truncate font-semibold text-foreground hover:text-accent">{label}</a>
      {name && symbol ? <p className="mt-0.5 truncate text-[11px] text-muted">${symbol}</p> : null}
    </div>
  </div>;
}
