"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import TradesTab from "@/components/TradesTab";
import HoldersTab from "@/components/HoldersTab";

type Tab = "trades" | "holders";

export default function DetailTabs({ chainId, address }: { chainId: string; address: string }) {
  const [tab, setTab] = useState<Tab>("trades");

  const tabs: { id: Tab; label: string }[] = [
    { id: "trades", label: "Trades" },
    { id: "holders", label: "Holders" },
  ];

  return (
    <Card>
      <div className="flex items-center gap-1 border-b border-border px-2 pt-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
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
        {tab === "trades" ? (
          <TradesTab chainId={chainId} address={address} />
        ) : (
          <HoldersTab chainId={chainId} address={address} />
        )}
      </div>
    </Card>
  );
}
