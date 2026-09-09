"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import TradesTab from "@/components/TradesTab";
import HoldersTab from "@/components/HoldersTab";
import TokenOverviewTab from '@/components/TokenOverviewTab';

type Tab = "overview" | "trades" | "holders";

export default function DetailTabs({ chain, address }: { chain: string; address: string }) {
  const [tab, setTab] = useState<Tab>("overview");

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: "trades", label: "Trades" },
    { id: "holders", label: "Holders" },
  ];

  return (
    <Card>
      <div role="group" aria-label="Token detail sections" className="flex items-center gap-1 border-b border-border px-2 pt-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-t-md px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-b-2 border-accent text-foreground"
                : "border-b-2 border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-4">
        {tab === 'overview' ? (
          <TokenOverviewTab key={`${chain}:${address}`} chain={chain} address={address} />
        ) : tab === "trades" ? (
          <TradesTab chain={chain} address={address} />
        ) : (
          <HoldersTab chain={chain} address={address} />
        )}
      </div>
    </Card>
  );
}
