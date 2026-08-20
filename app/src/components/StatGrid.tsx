import { Card, CardHeader, StatCell } from "@/components/ui";
import { fmtUsd, fmtInt, fmtAge, fmtPct, DASH } from "@/lib/format";
import type { TokenDetails } from "@/lib/types";

function BuySellBar({
  label,
  buy,
  sell,
  fmt,
}: {
  label: string;
  buy?: number;
  sell?: number;
  fmt: (v: unknown) => string;
}) {
  if (buy === undefined && sell === undefined) return null;
  const b = buy ?? 0;
  const s = sell ?? 0;
  const total = b + s;
  const buyPct = total > 0 ? (b / total) * 100 : 50;
  const sellPct = 100 - buyPct;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px] text-muted">
        <span className="uppercase tracking-wide">{label}</span>
        <span className="tabular">
          <span className="text-up">{fmt(buy)}</span> / <span className="text-down">{fmt(sell)}</span>
        </span>
      </div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        {total > 0 ? (
          <>
            <div className="h-full bg-up" style={{ width: `${buyPct}%` }} />
            <div className="h-full bg-down" style={{ width: `${sellPct}%` }} />
          </>
        ) : (
          <div className="h-full w-full bg-surface-2" />
        )}
      </div>
    </div>
  );
}

export default function StatGrid({ data }: { data: TokenDetails }) {
  const showBonding = !data.bonded && data.bondingPercentage !== undefined;
  const showBondedAt = data.bonded && data.bondedAt !== undefined;

  return (
    <Card>
      <CardHeader>Overview</CardHeader>
      <div className="flex flex-col gap-4 p-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <StatCell label="Market Cap" value={fmtUsd(data.marketCapUSD)} />
          <StatCell label="FDV" value={fmtUsd(data.marketCapDilutedUSD)} />
          <StatCell label="Liquidity" value={fmtUsd(data.liquidityUSD)} />
          <StatCell label="Volume 24h" value={fmtUsd(data.volume24hUSD)} />
          <StatCell label="Holders" value={fmtInt(data.holdersCount)} />
          <StatCell label="Created" value={data.createdAt ? fmtAge(data.createdAt) : DASH} />
          {showBonding && <StatCell label="Bonding" value={fmtPct(data.bondingPercentage, { sign: false })} />}
          {showBondedAt && <StatCell label="Bonded" value={fmtAge(data.bondedAt)} sub="ago" />}
          <StatCell label="ATH" value={fmtUsd(data.athUSD)} />
          <StatCell label="ATL" value={fmtUsd(data.atlUSD)} />
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <BuySellBar label="Buys / Sells (24h)" buy={data.buys24h} sell={data.sells24h} fmt={fmtInt} />
          <BuySellBar
            label="Buy / Sell Volume (24h)"
            buy={data.volumeBuy24hUSD}
            sell={data.volumeSell24hUSD}
            fmt={fmtUsd}
          />
        </div>
      </div>
    </Card>
  );
}
