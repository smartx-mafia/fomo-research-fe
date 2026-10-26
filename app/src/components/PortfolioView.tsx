'use client';

import Link from 'next/link';
import {useState} from 'react';

import {positionTargetID, type PortfolioPosition, type PortfolioCycleScope} from '@/api/portfolio';
import {ClosedPortfolioPositions} from '@/components/PortfolioCycles';
import {OpinionComposer} from '@/components/OpinionComposer';
import {PortfolioActivity} from '@/components/PortfolioActivity';
import {ProgressivePortfolio} from '@/components/ProgressivePortfolio';
import {PortfolioTokenIdentity} from '@/components/PortfolioTokenIdentity';
import {PortfolioProfile} from '@/components/PortfolioProfile';
import {
  decimalSign,
  formatBaseUnitsExact,
  formatDecimalExact,
  marketValueFromBaseUnits,
} from '@/lib/exact-decimal';
import {shortAddr} from '@/lib/format';
import {useSession} from '@/session/storage';

function usd(value: string | undefined, digits = 2) {
  let formatted = formatDecimalExact(value, digits);
  if (formatted === '0' && decimalSign(value) !== 0) formatted = formatDecimalExact(value, 20);
  return formatted === '—' ? formatted : `$${formatted}`;
}

function pnlClass(value: string | undefined) {
  const sign = decimalSign(value);
  return sign === 1 ? 'text-up' : sign === -1 ? 'text-down' : 'text-muted';
}

function PositionRow({position, onOpenOpinion, onOpenCycle}: {position: PortfolioPosition; onOpenOpinion: (targetID: string, label?: string) => void; onOpenCycle: (scope: PortfolioCycleScope) => void}) {
  const targetID = positionTargetID(position);
  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-3">
        <PortfolioTokenIdentity chain={position.asset.chain} address={position.asset.token_address} symbol={position.symbol} logo={position.logo} />
      </td>
      <td className="px-3 py-3 text-right font-mono text-xs">{formatBaseUnitsExact(position.shares_raw, position.decimals)}{position.pending_shares && position.pending_shares !== '0' ? <p className="mt-1 text-accent">Settlement pending: {position.pending_shares} raw</p> : null}<p className="mt-1 text-muted">Sellable: {position.sellable_shares === undefined ? '—' : formatBaseUnitsExact(position.sellable_shares, position.decimals)}</p></td>
      <td className="px-3 py-3 text-right font-mono text-xs">{usd(position.price_usd, 12)}</td>
      <td className="px-3 py-3 text-right font-mono text-xs">{usd(position.market_value_usd)}</td>
      <td className={`px-3 py-3 text-right font-mono text-xs ${pnlClass(position.pnl_ratio)}`}>{position.pnl_ratio === undefined ? '—' : `${formatDecimalExact(marketValueFromBaseUnits('100', 0, position.pnl_ratio), 4)}%`}</td>
      <td className="px-3 py-3 text-right font-mono text-xs">{usd(position.buy_value_usd)}</td>
      <td className="px-3 py-3 text-right font-mono text-xs">{usd(position.avg_buy_price_usd, 12)}</td>
      <td className="px-3 py-3 text-right text-xs">
        <button type="button" disabled={!position.cycle_key || position.cycle_status !== 'ready'} title={!position.cycle_key ? 'This cycle is not ready yet' : undefined}
          onClick={() => {if (position.cycle_key) onOpenCycle({chain: position.asset.chain, asset: position.asset.token_address, cycle_key: position.cycle_key});}}
          className="block w-full whitespace-nowrap rounded-md border border-border px-2 py-1 text-[11px] text-accent disabled:cursor-not-allowed disabled:opacity-50">Cycle trades</button>
        <button
          type="button"
          disabled={targetID === undefined}
          title={targetID === undefined ? 'This round is still being calculated' : undefined}
          onClick={() => {
            if (targetID === undefined) return;
            onOpenOpinion(targetID, position.symbol ? `$${position.symbol}` : shortAddr(position.asset.token_address));
          }}
          className="mt-2 block w-full rounded-md border border-border px-2 py-1 text-[11px] text-foreground hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          Opinion
        </button>
      </td>
    </tr>
  );
}

export function PortfolioView() {
  const session = useSession();
  const accountKey = `${session?.user?.identifier ?? ''}:${session?.jwt ?? ''}`;
  return <>
    {session?.user?.identifier ? <PortfolioProfile key={`profile:${accountKey}`} bearer={session.jwt} initialUser={session.user} /> : null}
    <PortfolioAccountView key={`holdings:${accountKey}`} />
  </>;
}

function PortfolioAccountView() {
  const session = useSession();
  const [opinionTarget, setOpinionTarget] = useState<{targetID: string; label?: string}>();
  const [opinionNotice, setOpinionNotice] = useState<string>();
  if (!session) return <div className="py-20 text-center"><h1>Your portfolio</h1><p>Sign in to view your trading positions and USDC cash.</p><Link href="/login">Sign in</Link></div>;
  const identifier = session.user?.identifier;
  if (!identifier) return <p role="alert">Your user identifier is unavailable. Please sign in again.</p>;
  return <>
    <ProgressivePortfolio identifier={identifier} bearer={session.jwt}
      renderPosition={(position, open) => <PositionRow position={position} onOpenCycle={open} onOpenOpinion={(targetID, label) => {setOpinionNotice(undefined); setOpinionTarget({targetID, label});}} />}
      renderHistory={(open, epoch) => <><ClosedPortfolioPositions key={`closed:${identifier}:${session.jwt}`} historyEpoch={epoch} bearer={session.jwt} userIdentifier={identifier} onOpenCycle={open} /><PortfolioActivity key={`${identifier}:${session.jwt}`} bearer={session.jwt} userIdentifier={identifier} /></>} />
    {opinionNotice ? <p role="status">{opinionNotice}</p> : null}
    {opinionTarget ? <OpinionComposer targetID={opinionTarget.targetID} targetLabel={opinionTarget.label} onClose={() => setOpinionTarget(undefined)} onPublished={() => setOpinionNotice('Opinion published.')} onDeleted={() => setOpinionNotice('Opinion deleted.')} /> : null}
  </>;
}
