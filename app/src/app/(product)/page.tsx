import { TokenTable } from "@/components/TokenTable";
import { SearchBox } from "@/components/SearchBox";

export default function Home() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Discover</h1>
        <p className="text-sm text-muted">
          Cross-chain token boards — trending, bonding curves, recently graduated tokens, top
          crypto by FDV and the most-held tokens among tracked accounts, streamed in real time.
        </p>
      </div>

      <SearchBox />

      {/* 不做服务端 API 预取：榜单由浏览器直接连接行情 WS，便于 DevTools 检查。 */}
      <TokenTable initialTrending={null} />
    </div>
  );
}
