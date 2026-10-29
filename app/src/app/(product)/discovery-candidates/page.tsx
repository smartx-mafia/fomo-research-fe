import {TokenTable} from "@/components/TokenTable";
export default function DiscoveryCandidatesPage() {
 return <div className="flex flex-col gap-4"><h1 className="text-xl font-semibold">候选全量研究</h1><TokenTable initialTrending={null} initialBoard="discovery_candidates" /></div>;
}
