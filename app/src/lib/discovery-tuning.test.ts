import {describe,expect,it} from 'vitest';
import type {DiscoveryCandidate,DiscoveryResearchData,DiscoveryReason} from './discovery';
import {TUNING_CHANNELS,defaultTuningForm,parseTuningForm,simulateDiscovery,exportTuningRun,readTuningPlans,validLaneHit,type TuningChannel,type TuningConfig} from './discovery-tuning';
export const batchAt=1792150000000;
export function evidence(lane:TuningChannel,rank=1):DiscoveryReason{
 return {code:lane,label:lane,upstream_rank:rank,observed_at_ms:batchAt,metric:lane==='new_tokens'?'token_created_at':lane==='volume_spike'?'volume_change_5m':lane==='price_up'?'price_change_5m':'upstream_rank',unit:lane==='new_tokens'?'unix_ms':lane==='volume_spike'||lane==='price_up'?'percent':'rank',value:lane==='new_tokens'?batchAt-3600000:lane==='volume_spike'?150:lane==='price_up'?10:rank};
}
export function candidate(address:string,lane:TuningChannel,rank=1,over:Partial<DiscoveryCandidate>={}):DiscoveryCandidate{return {chain:'bsc',address,symbol:address,name:address,selection_state:'selected',exclusion_reason:'',sources:[evidence(lane,rank)],price:1,liquidity:50000,volume_5m:10000,buyers_5m:30,fdv:1000000,token_created_at_ms:batchAt-3600000,...over};}
export function dataset(candidates:DiscoveryCandidate[]):DiscoveryResearchData{return {generated_at_ms:batchAt,state:'complete',source_row_count:candidates.length,unique_count:candidates.length,qualified_count:candidates.length,selected_count:Math.min(candidates.length,100),candidates};}
function config(data:DiscoveryResearchData):TuningConfig{return parseTuningForm(defaultTuningForm(data)).config!;}
describe('front-end discovery tuning',()=>{
 it('applies 20/15/50/10/5 shares with deterministic output and no source mutation',()=>{
  const data=dataset(TUNING_CHANNELS.flatMap(lane=>Array.from({length:20},(_,i)=>candidate(`${lane}-${i}`,lane,i+1))));const before=JSON.stringify(data);const c=config(data);c.limit=20;
  const result=simulateDiscovery(data,c);expect(result.rows).toHaveLength(20);
  expect(TUNING_CHANNELS.map(k=>result.allocation[k].selected)).toEqual([4,3,10,2,1]);
  expect(simulateDiscovery({...data,candidates:[...data.candidates].reverse()},c).rows).toEqual(result.rows);expect(JSON.stringify(data)).toBe(before);
 });
 it('does not refill from zero-weight lanes and reports quota shortage instead of inventing 50 percent',()=>{
  const data=dataset([candidate('new','new_tokens'),...Array.from({length:30},(_,i)=>candidate(`hot${i}`,'hot_5m',i+1))]);const c=config(data);c.limit=20;
  let result=simulateDiscovery(data,c);expect(result.rows).toHaveLength(20);expect(result.allocation.new_tokens.selected).toBe(1);expect(result.allocation.new_tokens.actualPercent).toBe(5);
  c.weights={hot_5m:0,volume_spike:0,new_tokens:100,price_up:0,hot_24h:0};result=simulateDiscovery(data,c);expect(result.rows).toHaveLength(1);expect(result.rows[0].token.address).toBe('new');
 });
 it('deduplicates chain/address, retains cross-chain identities and distinguishes hits from allocated slots',()=>{
  const shared=candidate('same','new_tokens',1,{sources:[evidence('new_tokens'),evidence('hot_5m')]});const data=dataset([shared,shared,{...shared,chain:'solana'}]);const result=simulateDiscovery(data,config(data));
  expect(result.sourceCount).toBe(2);expect(result.rows).toHaveLength(2);expect(result.rows[0].token.sources).toHaveLength(2);expect(TUNING_CHANNELS.reduce((n,k)=>n+result.allocation[k].selected,0)).toBe(2);
 });
 it('excludes backend rejected rows by default, keeps unknown metrics last and filters missing values honestly',()=>{
  const data=dataset([candidate('unknown','hot_5m',1,{fdv:undefined}),candidate('small','hot_5m',2,{fdv:10}),candidate('large','hot_5m',3,{fdv:100}),candidate('rejected','hot_5m',4,{selection_state:'risk_excluded'})]);const c=config(data);c.weights={hot_5m:100,new_tokens:0,volume_spike:0,price_up:0,hot_24h:0};c.finalSort='fdv';c.finalDirection='asc';
  expect(simulateDiscovery(data,c).rows.map(r=>r.token.address)).toEqual(['small','large','unknown']);
  c.finalDirection='desc';expect(simulateDiscovery(data,c).rows.map(r=>r.token.address)).toEqual(['large','small','unknown']);
  c.filters.minFDV=0;expect(simulateDiscovery(data,c).missingMetricCount).toBe(1);
  c.scope='all';expect(simulateDiscovery(data,c).rows.some(r=>r.token.address==='rejected')).toBe(true);
 });
 it('changes within-lane order before selection and global ordering after selection',()=>{
  const data=dataset([candidate('a','hot_5m',1,{volume_5m:2000}),candidate('b','hot_5m',2,{volume_5m:9000}),candidate('c','hot_5m',3,{volume_5m:5000})]);const c=config(data);c.weights={hot_5m:100,new_tokens:0,volume_spike:0,price_up:0,hot_24h:0};c.limit=2;c.laneSort.hot_5m={metric:'volume_5m',direction:'desc'};
  const weighted=simulateDiscovery(data,c);expect(weighted.rows.map(r=>r.token.address)).toEqual(['b','c']);c.finalSort='volume_5m';c.finalDirection='asc';
  const ordered=simulateDiscovery(data,c);expect(ordered.rows.map(r=>r.token.address)).toEqual(['c','b']);expect(ordered.rows.map(r=>r.mixedRank)).toEqual([2,1]);
 });
 it('validates raw lane evidence and measures age against the frozen batch',()=>{
  const invalid=candidate('wrong','price_up',1,{sources:[{...evidence('price_up'),value:undefined}]});expect(validLaneHit(invalid,'price_up')).toBe(false);
  const old=candidate('old','new_tokens',1,{sources:[{...evidence('new_tokens'),value:batchAt-25*3600000}]});expect(validLaneHit(old,'new_tokens')).toBe(false);
  const data=dataset([candidate('new','new_tokens')]);const c=config(data);c.filters.maxAgeHours=2;expect(simulateDiscovery(data,c).rows).toHaveLength(1);c.filters.maxAgeHours=0.5;expect(simulateDiscovery(data,c).rows).toHaveLength(0);
 });
 it('blocks invalid totals, ranges and stored malformed plans; exports exact candidates and config',()=>{
  const data=dataset([candidate('one','new_tokens')]);const form=defaultTuningForm(data);form.weights.new_tokens='49';expect(parseTuningForm(form).config).toBeUndefined();form.weights.new_tokens='50';form.filters.minFDV='20';form.filters.maxFDV='10';expect(parseTuningForm(form).config).toBeUndefined();
  const clean=defaultTuningForm(data),c=parseTuningForm(clean).config!,result=simulateDiscovery(data,c);const exported=exportTuningRun(data,c,'PM review','check distribution',result);
  expect(JSON.parse(JSON.stringify(exported)).snapshot).toEqual(JSON.parse(JSON.stringify(data)));expect(exported.config).toEqual(c);expect(exported.experiment_only).toBe(true);
  expect(readTuningPlans('[{}]')).toEqual([]);expect(readTuningPlans('invalid')).toEqual([]);expect(readTuningPlans(JSON.stringify([{id:'1',name:'v1',notes:'test',createdAt:'2026-10-16',form:clean}]))).toHaveLength(1);
 });
});

it('PM import round-trips the frozen input and recomputes results instead of trusting saved ranks', async()=>{
 const {importTuningRun}=await import('./discovery-tuning');const data=dataset([candidate('one','new_tokens')]);const form=defaultTuningForm(data),c=parseTuningForm(form).config!,expected=simulateDiscovery(data,c);
 const exported=JSON.parse(JSON.stringify(exportTuningRun(data,c,'v1','review',expected)));exported.result.rows=[];
 const imported=importTuningRun(exported);expect(simulateDiscovery(imported.snapshot,parseTuningForm(imported.form).config!).rows).toEqual(expected.rows);
 exported.config.weights.new_tokens=101;expect(()=>importTuningRun(exported)).toThrow('参数无效');
 expect(()=>importTuningRun({schema_version:99})).toThrow('格式');
});
