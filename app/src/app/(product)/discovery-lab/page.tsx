import {TokenTable} from "@/components/TokenTable";

export default function DiscoveryLabPage() {
  return <div className="flex flex-col gap-4">
    <h1 className="text-xl font-semibold tracking-tight text-foreground">代币发现实验</h1>
    <p className="text-sm text-muted">切换到 Trending 可对照现有榜单；测试榜独立取数，不替换正式榜单。</p>
    <TokenTable initialTrending={null} initialBoard="discovery_lab" />
  </div>;
}
