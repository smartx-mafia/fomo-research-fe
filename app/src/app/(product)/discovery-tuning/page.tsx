import {DiscoveryResearch} from '@/components/DiscoveryResearch';
import {Card} from '@/components/ui';
export default function DiscoveryTuningPage(){
 return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-xl font-semibold">榜单调参</h1><a className="text-sm underline" href="/discovery-lab">返回机会榜</a></div><Card><DiscoveryResearch initialMode="tuning" /></Card></div>;
}
