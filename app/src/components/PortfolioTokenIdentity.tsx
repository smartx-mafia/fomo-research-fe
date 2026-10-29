import {shortAddr} from '@/lib/format';
import {TokenAvatarView, useTokenDisplay} from '@/components/TokenAvatar';

export function PortfolioTokenIdentity({chain, address, symbol, name, logo}: {
  chain: string; address: string; symbol?: string; name?: string; logo?: string;
}) {
  const {info, isFavorited, personalReady} = useTokenDisplay(chain, address);
  const label = info?.name ?? info?.symbol ?? name ?? symbol ?? shortAddr(address);
  return <div className="flex min-w-[150px] items-center gap-2.5">
    <TokenAvatarView info={info} isFavorited={isFavorited} personalReady={personalReady} size={36}
      fallbackLogo={logo} fallbackSymbol={symbol} fallbackName={name} />
    <div className="min-w-0">
      <a href={`/token/${encodeURIComponent(chain)}/${encodeURIComponent(address)}`} className="block truncate font-semibold text-foreground hover:text-accent">{label}</a>
      {(info?.name ?? name) && (info?.symbol ?? symbol) ? <p className="mt-0.5 truncate text-[11px] text-muted">${info?.symbol ?? symbol}</p> : null}
    </div>
  </div>;
}
