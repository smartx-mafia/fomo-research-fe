import { fetchBoard } from "@/lib/market";
import type { TokenMarket } from "@/lib/types";
import { TokenTable } from "@/components/TokenTable";
import { SearchBox } from "@/components/SearchBox";

export default async function Home() {
  // HTTP 榜单接口只做 SSR 首屏兜底（§5 推荐策略）；拉不到也不阻塞渲染，
  // 客户端 WS subscribe 即有 snapshot。四榜均为跨链聚合榜，没有链参数。
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
          Cross-chain token boards — trending, bonding curves, recently graduated tokens and top
          crypto by FDV, streamed in real time over WebSocket.
        </p>
      </div>

      <SearchBox />

      <TokenTable initialTrending={initialTrending} />
    </div>
  );
}
