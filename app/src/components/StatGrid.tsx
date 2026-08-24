"use client";

import { Card, CardHeader, StatCell } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { fmtUsd, fmtInt, fmtAge, fmtPct, DASH } from "@/lib/format";
import type { TokenMarket } from "@/lib/types";

/** 会被 WS 实时刷新的格子：包一层 Flash，更新时按涨跌闪色 */
function LiveCell({ label, raw, text }: { label: string; raw: unknown; text: string }) {
  return <StatCell label={label} value={<Flash value={raw}>{text}</Flash>} />;
}

export default function StatGrid({ data }: { data: TokenMarket }) {
  const showBonding = !data.bonded && data.bonding_percentage !== undefined;

  return (
    <Card>
      <CardHeader>Overview</CardHeader>
      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-4">
        <LiveCell label="Market Cap" raw={data.market_cap} text={fmtUsd(data.market_cap)} />
        <LiveCell label="FDV" raw={data.market_cap_diluted} text={fmtUsd(data.market_cap_diluted)} />
        <LiveCell label="Liquidity" raw={data.liquidity} text={fmtUsd(data.liquidity)} />
        <LiveCell label="Holders" raw={data.holders_count} text={fmtInt(data.holders_count)} />
        <LiveCell label="Volume 1h" raw={data.volume_1h} text={fmtUsd(data.volume_1h)} />
        <LiveCell label="Volume 24h" raw={data.volume_24h} text={fmtUsd(data.volume_24h)} />
        <LiveCell label="Trades 1h" raw={data.trades_1h} text={fmtInt(data.trades_1h)} />
        <LiveCell label="Trades 24h" raw={data.trades_24h} text={fmtInt(data.trades_24h)} />
        <LiveCell label="Buyers 24h" raw={data.buyers_24h} text={fmtInt(data.buyers_24h)} />
        <StatCell
          label="Security Score"
          value={data.security_score !== undefined ? fmtInt(data.security_score) : DASH}
        />
        <StatCell label="Created" value={data.created_at ? fmtAge(data.created_at) : DASH} sub="ago" />
        {showBonding && (
          <LiveCell
            label="Bonding"
            raw={data.bonding_percentage}
            text={fmtPct(data.bonding_percentage, { sign: false })}
          />
        )}
        {data.bonded && <StatCell label="Bonding" value="Graduated" />}
      </div>
    </Card>
  );
}
