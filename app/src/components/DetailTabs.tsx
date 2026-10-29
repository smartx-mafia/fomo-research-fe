"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import TradesTab from "@/components/TradesTab";
import HoldersTab from "@/components/HoldersTab";
import TokenOpinionsTab from "@/components/TokenOpinionsTab";
import TokenOverviewTab from '@/components/TokenOverviewTab';

type Tab = "overview" | "opinions" | "trades" | "holders";

export default function DetailTabs({ chain, address }: { chain: string; address: string }) {
  const [tab, setTab] = useState<Tab>("overview");

  const tabs: { id: Tab; label: string }[] = [
    { id: "holders", label: "Holders" },
    { id: "opinions", label: "Opinions" },
    { id: "trades", label: "Trades" },
    { id: 'overview', label: 'Overview' },
  ];

  return (
    <Card className="overflow-hidden">
      <div role="tablist" aria-label="Token detail sections" className="flex overflow-x-auto border-b border-border px-3 pt-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`token-detail-tab-${t.id}`}
            aria-controls={`token-detail-panel-${t.id}`}
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`min-w-[92px] px-3 py-3 text-center text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-b-2 border-foreground text-foreground"
                : "border-b-2 border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id={`token-detail-panel-${tab}`} role="tabpanel" aria-labelledby={`token-detail-tab-${tab}`} tabIndex={0} className={tab === 'holders' || tab === 'opinions' ? '' : 'p-4'}>
        {tab === 'overview' ? (
          <TokenOverviewTab key={`${chain}:${address}`} chain={chain} address={address} />
        ) : tab === 'opinions' ? (
          <TokenOpinionsTab key={`opinions:${chain}:${address}`} chain={chain} address={address} />
        ) : tab === "trades" ? (
          <TradesTab chain={chain} address={address} />
        ) : (
          <HoldersTab chain={chain} address={address} />
        )}
      </div>
    </Card>
  );
}
