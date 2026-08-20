import { fetchPulse } from "@/lib/mobula";
import { buildPulseViews, DEFAULT_CHAINS } from "@/lib/pulseViews";
import type { PulseResponse } from "@/lib/types";
import { TokenTable } from "@/components/TokenTable";
import { ChainFilter } from "@/components/ChainFilter";
import { ErrorState } from "@/components/ui";

type SearchParams = Promise<{ chains?: string }>;

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const chains = sp.chains ? sp.chains.split(",").filter(Boolean) : DEFAULT_CHAINS;

  let initialData: PulseResponse = {};
  let error: string | null = null;
  try {
    initialData = await fetchPulse(buildPulseViews(chains));
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load Mobula data";
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Discover</h1>
        <p className="text-sm text-muted">
          Live token pulse across Solana, Base and BNB — trending, new listings, bonding curves and graduated
          tokens, powered by Mobula.
        </p>
      </div>

      <ChainFilter selected={chains} />

      {error ? (
        <ErrorState message={error} />
      ) : (
        <TokenTable initialData={initialData} chains={chains} />
      )}
    </div>
  );
}
