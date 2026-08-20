import type { PulseView } from "@/lib/mobula";

/** Default three-chain set used across the Discover page (Solana, Base, BNB). */
export const DEFAULT_CHAINS = ["solana:solana", "evm:8453", "evm:56"];

export const TABS = ["trending", "new", "bonding", "bonded"] as const;
export type TabName = (typeof TABS)[number];

export const TAB_LABELS: Record<TabName, string> = {
  trending: "Trending",
  new: "New",
  bonding: "Bonding",
  bonded: "Bonded",
};

/**
 * Builds the 4-view Mobula /pulse request body shared by the server component
 * (page.tsx, initial SSR fetch) and the client poller (TokenTable.tsx, refresh
 * every 5s) so both sides always request the exact same data shape.
 */
export function buildPulseViews(chains: string[] = DEFAULT_CHAINS): PulseView[] {
  return [
    {
      name: "trending",
      chainId: chains,
      sortBy: "fees_paid_5min",
      sortOrder: "desc",
      limit: 50,
      filters: { liquidity: { gte: 37500 }, trades_1h: { gte: 100 } },
    },
    { name: "new", model: "new", chainId: chains, limit: 50 },
    { name: "bonding", model: "bonding", chainId: chains, limit: 50 },
    { name: "bonded", model: "bonded", chainId: chains, limit: 50 },
  ];
}
