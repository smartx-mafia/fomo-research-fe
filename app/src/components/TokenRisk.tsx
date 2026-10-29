'use client';

import {useState} from 'react';
import {Dialog} from 'radix-ui';
import {AlertTriangle, X} from 'lucide-react';
import {useTokenRisk} from '@/hooks/useTokenRisk';
import {useRiskCheckState} from '@/hooks/useRiskCheckState';
import {riskDisplayParams, riskHeading, riskItemCopy, riskItemTitle, riskSource, riskTradeAction, type RiskAssessment, type RiskItem} from '@/lib/risk-assessment';

export function RiskDetails({risk, refreshFailed = false}: {risk?: RiskAssessment; refreshFailed?: boolean}) {
  const checksReusable = useRiskCheckState(risk, refreshFailed);
  const items = risk?.items ?? [];
  const sources = [...new Set(items.map((item) => item.displaySource))].sort((a, b) => {
    const priority = (value: string) => value === 'goplus' ? 0 : value === 'codex' ? 1 : 2;
    return priority(a) - priority(b);
  });
  function list(rows: RiskItem[]) {
    return <ul className="space-y-3">{rows.map((item) => {
      const [, explanation] = riskItemCopy(item);
      const params = riskDisplayParams(item);
      return <li key={item.code} className="rounded-md border border-border p-3">
        <p className="font-medium text-foreground">{riskItemTitle(item)}</p>
        <p className="mt-1 text-sm text-muted">{explanation}</p>
        {params.length > 0 ? <dl className="mt-2 text-xs text-muted">{params.map(({key, label, value}) => (
          <div key={key} className="flex flex-wrap gap-2 break-all"><dt>{label}:</dt><dd>{value}</dd></div>
        ))}</dl> : null}
      </li>;
    })}</ul>;
  }
  return <div className="space-y-3">
    {items.length === 0 ? <p className="text-sm text-muted">Risk data is unavailable or incomplete. This does not mean the token is safe. Ordinary transaction checks still apply.</p> : sources.length > 1 ? sources.map((source) => <section key={source}>
      <h3 className="mb-2 text-sm font-semibold text-foreground">{riskSource(source)}</h3>
      {list(items.filter((item) => item.displaySource === source))}
    </section>) : list(items)}
    {sources.length === 1 ? <p className="text-xs text-muted">Source: {riskSource(sources[0])}</p> : null}
    {items.length > 0 && !checksReusable ? <aside role="status" className="rounded-md border border-border bg-surface-2 p-3 text-xs text-muted">
      <p className="font-medium">Risk checks unavailable</p>
      <p className="mt-1">Some checks are incomplete or no longer current. Known risks remain listed. Ordinary transaction checks still apply.</p>
    </aside> : null}
    {risk?.mode === 'observe' ? <p className="text-xs text-muted">Observation only. This assessment does not restrict trading.</p> : null}
  </div>;
}

export function RiskDialog({risk, open, onClose, onConfirm, blocked = false, refreshFailed = false}: {
  risk?: RiskAssessment; open: boolean; onClose: () => void; onConfirm?: () => void; blocked?: boolean; refreshFailed?: boolean;
}) {
  const buyingBlocked = blocked || riskTradeAction(risk, 'buy') === 'block';
  const canConfirm = !!onConfirm && !buyingBlocked;
  return <Dialog.Root open={open} onOpenChange={(value) => {if (!value) onClose();}}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
      <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col overflow-hidden rounded-t-xl border border-border bg-surface shadow-xl sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl">
        <header className="shrink-0 px-5 pt-5 pb-3" data-testid="risk-dialog-header">
          <Dialog.Title className="pr-8 text-lg font-semibold text-foreground">{buyingBlocked ? 'High risk · Buying unavailable' : riskHeading(risk)}</Dialog.Title>
          <Dialog.Description className="mt-3 text-sm text-muted">{buyingBlocked ? 'Buying is unavailable because of the reported risks. This buy restriction does not apply to selling. Ordinary transaction checks still apply.' : canConfirm ? 'Read the specific risks below before continuing with this purchase.' : 'Reported risks are not a guarantee of safety or future performance.'}</Dialog.Description>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-2" data-testid="risk-dialog-body">
          <RiskDetails risk={risk} refreshFailed={refreshFailed} />
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-4" data-testid="risk-dialog-actions">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm text-foreground">{canConfirm ? 'Cancel' : 'Close'}</button>
          {canConfirm ? <button type="button" onClick={onConfirm} disabled={!risk?.confirmationVersion || !risk.items.length} className="rounded-md bg-orange-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">I understand the risks · Continue buy</button> : null}
        </footer>
        <Dialog.Close aria-label="Close risk details" className="absolute right-4 top-4 text-muted"><X className="h-4 w-4" /></Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function RiskBanner({risk, refreshFailed = false}: {risk?: RiskAssessment; refreshFailed?: boolean}) {
  const [open, setOpen] = useState(false);
  const checksReusable = useRiskCheckState(risk, refreshFailed);
  if (risk?.grade === 1 && checksReusable && risk.items.length === 0) return null;
  const grade = risk?.grade ?? 0;
  const items = risk?.items ?? [];
  const tone = grade === 5 ? 'border-red-500/30 bg-red-500/10 text-red-400' : grade === 4 ? 'border-orange-500/30 bg-orange-500/10 text-orange-400' : grade === 2 || grade === 3 ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400' : 'border-border bg-surface-2 text-muted';
  const title = items.length === 1 ? riskItemTitle(items[0]) : items.length > 1 ? `${riskHeading(risk)} · ${items.length}` : riskHeading(risk);
  return <>
    <button type="button" onClick={() => setOpen(true)} className={`flex w-full items-center gap-2 rounded-lg border px-4 py-3 text-left text-sm ${tone}`} aria-label={`${title}. View risk details`}>
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1"><span className="font-medium">{title}</span>{items.length > 0 && !checksReusable ? <span className="mt-1 block text-xs">Some checks are unavailable. Known risks remain listed.</span> : refreshFailed ? <span className="mt-1 block text-xs">Refresh unavailable. Showing the last known assessment.</span> : null}</span>
      <span className="text-xs underline">Details</span>
    </button>
    <RiskDialog risk={risk} open={open} refreshFailed={refreshFailed} onClose={() => setOpen(false)} />
  </>;
}

export function TokenRiskBanner({chain, address}: {chain: string; address: string}) {
  const {risk, error} = useTokenRisk(chain, address);
  return <RiskBanner risk={risk} refreshFailed={!!error} />;
}
