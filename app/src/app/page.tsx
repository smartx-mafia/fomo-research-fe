import { fetchBoard } from "@/lib/market";
import { CHAINS, type TokenMarket } from "@/lib/types";
import { TokenTable } from "@/components/TokenTable";
import { ChainFilter } from "@/components/ChainFilter";

type SearchParams = Promise<{ chains?: string }>;

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const chains = sp.chains ? sp.chains.split(",").filter(Boolean) : [...CHAINS];

  // HTTP 榜单接口只做 SSR 首屏兜底（§5 推荐策略）；拉不到也不阻塞渲染，
  // 客户端 WS subscribe 即有 snapshot。
  let initialTrending: TokenMarket[] | null = null;
  try {
    initialTrending = (await fetchBoard("trending")).items;
  } catch {
    // ignore：交给 WS
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Discover</h1>
        <p className="text-sm text-muted">
          Live token boards — trending, new listings, bonding curves and graduated tokens, streamed in
          real time over WebSocket.
        </p>
      </div>

      <ChainFilter selected={chains} />

      <TokenTable initialTrending={initialTrending} chains={chains} />
    </div>
  );
}
