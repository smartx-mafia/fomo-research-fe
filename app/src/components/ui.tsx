import { fmtPct, pctColor, chainLabel } from "@/lib/format";

export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`rounded-lg border border-border bg-surface ${className}`}>{children}</div>;
}

export function CardHeader({ children }: { children: React.ReactNode }) {
  return <div className="border-b border-border px-4 py-3 text-sm font-medium text-muted">{children}</div>;
}

export function StatCell({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-2 px-3 py-2">
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
      <span className="tabular text-sm font-semibold text-foreground">{value}</span>
      {sub !== undefined && <span className="text-xs text-muted">{sub}</span>}
    </div>
  );
}

export function PctBadge({ value, digits }: { value: unknown; digits?: number }) {
  return <span className={`tabular font-medium ${pctColor(value)}`}>{fmtPct(value, { digits })}</span>;
}

export function ChainBadge({ chainId }: { chainId: unknown }) {
  return (
    <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
      {chainLabel(chainId)}
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-surface-2 ${className}`} />;
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-32 items-center justify-center text-sm text-muted">{children}</div>;
}

export function ErrorState({ message }: { message?: string }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-1 text-sm text-down">
      <span>Failed to load data</span>
      {message && <span className="text-xs text-muted">{message}</span>}
    </div>
  );
}
