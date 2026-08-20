import { fetchTokenDetails } from "@/lib/mobula";
import { slugToChain } from "@/lib/format";
import TokenHeader from "@/components/TokenHeader";
import StatGrid from "@/components/StatGrid";
import SecurityPanel from "@/components/SecurityPanel";
import DetailTabs from "@/components/DetailTabs";
import PriceChart from "@/components/PriceChart";
import type { TokenDetails } from "@/lib/types";

export default async function TokenDetailPage({
  params,
}: {
  params: Promise<{ chain: string; address: string }>;
}) {
  const { chain, address } = await params;
  const chainId = slugToChain(chain);

  let data: TokenDetails | undefined;
  let errorMessage: string | undefined;

  try {
    const res = await fetchTokenDetails(chainId, address);
    data = res.data;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Unknown error";
  }

  if (!data || !data.address) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
        <h1 className="text-lg font-semibold text-foreground">Token not found</h1>
        <p className="max-w-md text-sm text-muted">
          Could not load data for <span className="font-mono">{address}</span> on{" "}
          <span className="font-mono">{chainId}</span>.
          {errorMessage && <span className="mt-1 block text-xs text-muted">{errorMessage}</span>}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <TokenHeader initialData={data} chainId={chainId} address={address} />

      <PriceChart chainId={chainId} address={address} createdAt={data.createdAt} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <StatGrid data={data} />
        </div>
        <div className="lg:col-span-1">
          <SecurityPanel data={data} />
        </div>
      </div>

      <DetailTabs chainId={chainId} address={address} />
    </div>
  );
}
