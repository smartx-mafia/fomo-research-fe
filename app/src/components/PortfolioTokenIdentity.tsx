'use client';

import {TokenAvatarView, useTokenDisplay} from '@/components/TokenAvatar';
import {shortAddr} from '@/lib/format';

export function PortfolioTokenIdentity({chain, address, symbol, name, logo}: {
  chain: string; address: string; symbol?: string; name?: string; logo?: string;
}) {
  const {info, isFavorited, personalReady} = useTokenDisplay(chain, address);
  const displaySymbol = info?.symbol ?? symbol;
  const displayName = info?.name ?? name;
  const label = displayName ?? displaySymbol ?? shortAddr(address);
  return <div className="flex min-w-[150px] items-center gap-2.5">
    <TokenAvatarView info={info} isFavorited={isFavorited} personalReady={personalReady} size={36} fallbackLogo={logo}
      fallbackSymbol={symbol} fallbackName={name} />
    <div className="min-w-0">
      <a href={`/token/${encodeURIComponent(chain)}/${encodeURIComponent(address)}`} className="block truncate font-semibold text-foreground hover:text-accent">{label}</a>
      {displayName && displaySymbol ? <p className="mt-0.5 truncate text-[11px] text-muted">${displaySymbol}</p> : null}
    </div>
  </div>;
}
