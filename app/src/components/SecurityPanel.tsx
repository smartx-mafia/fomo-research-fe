import { Card, CardHeader } from "@/components/ui";
import { fmtPct } from "@/lib/format";
import type { TokenDetails } from "@/lib/types";

/** goodWhenTrue: whether `true` should render as ✓ (green) rather than ✗ (red) */
function CheckRow({
  label,
  value,
  goodWhenTrue = true,
}: {
  label: string;
  value: boolean | undefined;
  goodWhenTrue?: boolean;
}) {
  if (value === undefined) return null;
  const isGood = goodWhenTrue ? value : !value;
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted">{label}</span>
      <span className={isGood ? "text-up" : "text-down"}>{isGood ? "✓" : "✗"}</span>
    </div>
  );
}

function TaxRow({ label, value }: { label: string; value: number | undefined }) {
  if (value === undefined) return null;
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted">{label}</span>
      <span className="tabular text-foreground">{fmtPct(value, { sign: false })}</span>
    </div>
  );
}

function HoldingBar({ label, value }: { label: string; value: number | undefined }) {
  if (value === undefined) return null;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px] text-muted">
        <span>{label}</span>
        <span className="tabular text-foreground">{fmtPct(value, { sign: false })}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function SecurityPanel({ data }: { data: TokenDetails }) {
  const s = data.security ?? {};
  const hasSecurity =
    s.isHoneypot !== undefined ||
    s.isMintable !== undefined ||
    s.renounced !== undefined ||
    s.locked !== undefined ||
    s.buyTax !== undefined ||
    s.sellTax !== undefined;

  const hasHoldings =
    data.top10HoldingsPercentage !== undefined ||
    data.devHoldingsPercentage !== undefined ||
    data.snipersHoldingsPercentage !== undefined ||
    data.insidersHoldingsPercentage !== undefined ||
    data.bundlersHoldingsPercentage !== undefined;

  return (
    <Card>
      <CardHeader>Security &amp; Holders</CardHeader>
      <div className="flex flex-col gap-4 p-4">
        {hasSecurity ? (
          <div className="flex flex-col gap-1.5">
            <CheckRow label="Not a honeypot" value={s.isHoneypot} goodWhenTrue={false} />
            <CheckRow label="Not mintable" value={s.isMintable} goodWhenTrue={false} />
            <CheckRow label="Renounced" value={s.renounced} goodWhenTrue={true} />
            <CheckRow label="Liquidity locked" value={s.locked} goodWhenTrue={true} />
            <TaxRow label="Buy tax" value={s.buyTax} />
            <TaxRow label="Sell tax" value={s.sellTax} />
          </div>
        ) : (
          <p className="text-xs text-muted">No security data available.</p>
        )}

        {hasHoldings && (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <HoldingBar label="Top 10 holders" value={data.top10HoldingsPercentage} />
            <HoldingBar label="Dev" value={data.devHoldingsPercentage} />
            <HoldingBar label="Snipers" value={data.snipersHoldingsPercentage} />
            <HoldingBar label="Insiders" value={data.insidersHoldingsPercentage} />
            <HoldingBar label="Bundlers" value={data.bundlersHoldingsPercentage} />
          </div>
        )}
      </div>
    </Card>
  );
}
