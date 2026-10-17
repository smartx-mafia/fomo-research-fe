import type {DiscoveryCandidate, DiscoveryResearchData} from './discovery';
import {discoveryChannelLabels,normalizeDiscoveryResearch} from './discovery';

// Canonical order also determines tie-breaking and exhausted-lane fallback.
export const TUNING_CHANNELS = ['hot_5m','volume_spike','new_tokens','price_up','hot_24h'] as const;
export type TuningChannel = typeof TUNING_CHANNELS[number];
export const TUNING_METRICS = {upstream_rank:'原通道名次',volume_5m:'5m 成交额',liquidity:'流动性',buyers_5m:'5m 独立买家',fdv:'FDV',token_created_at_ms:'创建时间'} as const;
export type TuningMetric = keyof typeof TUNING_METRICS;
export type Direction = 'asc'|'desc';
export const TUNING_FILTERS = {minLiquidity:'最低流动性（USD）',minVolume:'最低 5m 成交额（USD）',minBuyers:'最低 5m 独立买家',minFDV:'最低 FDV（USD）',maxFDV:'最高 FDV（USD）',maxAgeHours:'最大币龄（小时）'} as const;
type FilterKey = keyof typeof TUNING_FILTERS;
export interface TuningForm {
 weights: Record<TuningChannel,string>;
 laneSort: Record<TuningChannel,{metric:TuningMetric;direction:Direction}>;
 scope:'qualified'|'all'; chain:string; limit:string;
 filters:Record<FilterKey,string>;
 finalSort:'mixed'|Exclude<TuningMetric,'upstream_rank'>; finalDirection:Direction;
}
export interface TuningConfig extends Omit<TuningForm,'weights'|'filters'|'limit'> {
 weights:Record<TuningChannel,number>;filters:Partial<Record<FilterKey,number>>;limit:number;
}
const defaults:Record<TuningChannel,number>={hot_5m:20,volume_spike:15,new_tokens:50,price_up:10,hot_24h:5};
export function defaultTuningForm(data:DiscoveryResearchData):TuningForm {
 const incoming=data.discovery?.weights;
 const valid=incoming && TUNING_CHANNELS.every(k=>Number.isInteger(incoming[k])&&incoming[k]>=0&&incoming[k]<=100) && TUNING_CHANNELS.reduce((s,k)=>s+incoming[k],0)===100;
 const weights=valid?incoming:defaults;
 return {weights:Object.fromEntries(TUNING_CHANNELS.map(k=>[k,String(weights[k])])) as TuningForm['weights'],laneSort:Object.fromEntries(TUNING_CHANNELS.map(k=>[k,{metric:'upstream_rank',direction:'asc'}])) as TuningForm['laneSort'],scope:'qualified',chain:'',limit:'100',filters:{minLiquidity:'20000',minVolume:'1000',minBuyers:'10',minFDV:'',maxFDV:'',maxAgeHours:''},finalSort:'mixed',finalDirection:'desc'};
}
const object=(x:unknown):Record<string,unknown>=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:{};
const numeric=(x:unknown):number|undefined=>typeof x==='string'&&x.trim()!==''&&Number.isFinite(Number(x))?Number(x):undefined;
export function parseTuningForm(raw:unknown):{config?:TuningConfig;errors:string[]} {
 const r=object(raw),errors:string[]=[];const weights={} as TuningConfig['weights'];const sorts={} as TuningForm['laneSort'];const filters:TuningConfig['filters']={};
 for(const k of TUNING_CHANNELS){const w=numeric(object(r.weights)[k]);if(w===undefined||!Number.isInteger(w)||w<0||w>100)errors.push(`${discoveryChannelLabels[k]}权重须为 0–100 的整数`);else weights[k]=w;
 const sort=object(object(r.laneSort)[k]);if(!Object.hasOwn(TUNING_METRICS,String(sort.metric))||!['asc','desc'].includes(String(sort.direction)))errors.push('通道排序无效');else sorts[k]={metric:sort.metric as TuningMetric,direction:sort.direction as Direction};}
 if(TUNING_CHANNELS.every(k=>weights[k]!==undefined)&&TUNING_CHANNELS.reduce((s,k)=>s+weights[k],0)!==100)errors.push('五路权重合计必须为 100%');
 for(const k of Object.keys(TUNING_FILTERS) as FilterKey[]){const v=object(r.filters)[k];if(v==='')continue;const n=numeric(v);if(n===undefined||n<0)errors.push(`${TUNING_FILTERS[k]}须为空或非负数字`);else filters[k]=n;}
 if(filters.minFDV!==undefined&&filters.maxFDV!==undefined&&filters.minFDV>filters.maxFDV)errors.push('最低 FDV 不能大于最高 FDV');
 const limit=numeric(r.limit);if(limit===undefined||!Number.isInteger(limit)||limit<1||limit>100)errors.push('榜单数量须为 1–100 的整数');
 if(!['qualified','all'].includes(String(r.scope)))errors.push('候选范围无效');
 if(typeof r.chain!=='string'||r.chain.length>64)errors.push('链筛选无效');
 if(r.finalSort!=='mixed'&&(!Object.hasOwn(TUNING_METRICS,String(r.finalSort))||r.finalSort==='upstream_rank'))errors.push('最终排序无效');
 if(!['asc','desc'].includes(String(r.finalDirection)))errors.push('最终排序方向无效');
 if(errors.length)return {errors};
 return {errors,config:{weights,laneSort:sorts,filters,limit:limit!,scope:r.scope as TuningConfig['scope'],chain:r.chain as string,finalSort:r.finalSort as TuningConfig['finalSort'],finalDirection:r.finalDirection as Direction}};
}
export function tuningSlots(weights:TuningConfig['weights']):TuningChannel[]{
 const current=TUNING_CHANNELS.map(()=>0),out:TuningChannel[]=[];
 for(let n=0;n<100;n++){let best=-1;TUNING_CHANNELS.forEach((k,i)=>{current[i]+=weights[k];if(weights[k]>0&&(best<0||current[i]>current[best]))best=i;});if(best<0)break;out.push(TUNING_CHANNELS[best]);current[best]-=100;}
 return out;
}
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const id=(c:DiscoveryCandidate)=>`${c.chain}:${c.address}`;
const lexical=(a:string,b:string)=>a<b?-1:a>b?1:0;
function metric(c:DiscoveryCandidate,key:TuningMetric,lane?:TuningChannel):number|undefined {
 const v=key==='upstream_rank'?c.sources.find(s=>s.code===lane)?.upstream_rank:c[key];
 return finite(v)&&(!(key==='upstream_rank'||key==='token_created_at_ms')||v>0)?v:undefined;
}
function compare(a:DiscoveryCandidate,b:DiscoveryCandidate,key:TuningMetric,direction:Direction,lane?:TuningChannel):number {
 const av=metric(a,key,lane),bv=metric(b,key,lane);
 if(av===undefined||bv===undefined)return av===bv?0:av===undefined?1:-1;
 return (av-bv)*(direction==='asc'?1:-1);
}
// A raw query hit isn't always a valid lane hit. Retain observed evidence semantics.
export function validLaneHit(c:DiscoveryCandidate,lane:TuningChannel):boolean {
 const source=c.sources.find(s=>s.code===lane);
 if(!source||!finite(source.upstream_rank)||source.upstream_rank<1)return false;
 if(lane==='hot_5m'||lane==='hot_24h')return source.upstream_rank<=(lane==='hot_24h'?50:100);
 if(lane==='volume_spike')return source.metric==='volume_change_5m'&&source.unit==='percent'&&finite(source.value)&&source.value>=100;
 if(lane==='price_up')return source.metric==='price_change_5m'&&source.unit==='percent'&&finite(source.value)&&source.value>=5;
 return source.metric==='token_created_at'&&source.unit==='unix_ms'&&finite(source.value)&&finite(source.observed_at_ms)&&source.value>0&&source.value<=source.observed_at_ms&&source.observed_at_ms-source.value<=86400000;
}
export interface TuningRow {token:DiscoveryCandidate;assignedChannel:TuningChannel;mixedRank:number;rank:number}
export interface TuningResult {rows:TuningRow[];sourceCount:number;scopeCount:number;filteredCount:number;matchableCount:number;missingMetricCount:number;allocation:Record<TuningChannel,{available:number;selected:number;targetPercent:number;actualPercent:number}>}
export function simulateDiscovery(data:DiscoveryResearchData,config:TuningConfig):TuningResult {
 const unique=new Map<string,DiscoveryCandidate>();for(const c of data.candidates){if(!unique.has(id(c)))unique.set(id(c),c);}
 const scoped=[...unique.values()].filter(c=>config.scope==='all'||['selected','qualified_not_selected'].includes(c.selection_state));let missingMetricCount=0;
 const pool=scoped.filter(c=>{
  if(config.chain&&c.chain!==config.chain)return false;
  const tests:Array<[number|undefined,number|undefined,boolean]>=[[c.liquidity,config.filters.minLiquidity,false],[c.volume_5m,config.filters.minVolume,false],[c.buyers_5m,config.filters.minBuyers,false],[c.fdv,config.filters.minFDV,false],[c.fdv,config.filters.maxFDV,true]];
  if(config.filters.maxAgeHours!==undefined)tests.push([finite(c.token_created_at_ms)&&c.token_created_at_ms>0?(data.generated_at_ms-c.token_created_at_ms)/3600000:undefined,config.filters.maxAgeHours,true]);
  for(const [value,threshold,upper] of tests){if(threshold===undefined)continue;if(!finite(value)){missingMetricCount++;return false;}if(value<0||(upper?value>threshold:value<threshold))return false;}
  return true;
 });
 const queues=Object.fromEntries(TUNING_CHANNELS.map(k=>[k,pool.filter(c=>validLaneHit(c,k)).sort((a,b)=>compare(a,b,config.laneSort[k].metric,config.laneSort[k].direction,k)||lexical(id(a),id(b)))])) as Record<TuningChannel,DiscoveryCandidate[]>;
 const allocation=Object.fromEntries(TUNING_CHANNELS.map(k=>[k,{available:queues[k].length,selected:0,targetPercent:config.weights[k],actualPercent:0}])) as TuningResult['allocation'];
 const slots=tuningSlots(config.weights),cursors=Object.fromEntries(TUNING_CHANNELS.map(k=>[k,0])) as Record<TuningChannel,number>,used=new Set<string>(),rows:TuningRow[]=[];
 const take=(k:TuningChannel)=>{if(config.weights[k]===0)return false;while(cursors[k]<queues[k].length){const token=queues[k][cursors[k]++];if(used.has(id(token)))continue;used.add(id(token));allocation[k].selected++;rows.push({token,assignedChannel:k,mixedRank:rows.length+1,rank:rows.length+1});return true;}return false;};
 for(let slot=0;slots.length&&rows.length<config.limit;slot++){if(take(slots[slot%slots.length]))continue;if(!TUNING_CHANNELS.some(take))break;}
 if(config.finalSort!=='mixed'){const sort=config.finalSort;rows.sort((a,b)=>compare(a.token,b.token,sort,config.finalDirection)||a.mixedRank-b.mixedRank);rows.forEach((r,i)=>r.rank=i+1);}
 for(const k of TUNING_CHANNELS)allocation[k].actualPercent=rows.length?allocation[k].selected/rows.length*100:0;
 return {rows,sourceCount:unique.size,scopeCount:scoped.length,filteredCount:pool.length,matchableCount:new Set(TUNING_CHANNELS.filter(k=>config.weights[k]>0).flatMap(k=>queues[k].map(id))).size,missingMetricCount,allocation};
}
export interface SavedTuningPlan {id:string;name:string;notes:string;form:TuningForm;createdAt:string}
export function readTuningPlans(raw:string|null):SavedTuningPlan[]{
 try {const parsed:unknown=JSON.parse(raw??'[]');if(!Array.isArray(parsed))return [];return parsed.filter((p):p is SavedTuningPlan=>{const r=object(p);return typeof r.id==='string'&&typeof r.name==='string'&&r.name.length<=120&&typeof r.notes==='string'&&r.notes.length<=2000&&typeof r.createdAt==='string'&&!!parseTuningForm(r.form).config;}).slice(0,20);}catch{return [];}
}
export function exportTuningRun(data:DiscoveryResearchData,config:TuningConfig,name:string,notes:string,result:TuningResult,inputSource: 'server'|'import'='server') {
 return {schema_version:1,algorithm:'discovery-local-weighted-cycle-v1',experiment_only:true,input_source:inputSource,name,notes,exported_at:new Date().toISOString(),snapshot:data,config,result,limitations:['仅使用该批次五路查询地址全集，不能恢复上游未返回的候选','后端准入状态是批次观察，本地实验不改变交易风控','新币等来源通道沿用发现时证据；本地模拟不是后端重跑'],};
}
export function tuningSummary(data:DiscoveryResearchData,config:TuningConfig,name:string,notes:string,result:TuningResult):string {
 return [`方案：${name||'未命名方案'}`,`备注：${notes||'无'}`,`候选批次：${new Date(data.generated_at_ms).toISOString()}（${data.state}）`,`性质：仅前端模拟，未发布到正式榜单`,`范围：${config.scope==='qualified'?'本批通过后端筛选':'全部候选（含未通过者）'}；链：${config.chain||'全部'}；输出 ${result.rows.length}/${config.limit}`,`权重：${TUNING_CHANNELS.map(k=>`${discoveryChannelLabels[k]} ${config.weights[k]}%`).join(' / ')}`,`通道内排序：${TUNING_CHANNELS.map(k=>`${discoveryChannelLabels[k]}=${TUNING_METRICS[config.laneSort[k].metric]} ${config.laneSort[k].direction==='asc'?'升序':'降序'}`).join('；')}`,`最终展示：${config.finalSort==='mixed'?'权重混排顺序':TUNING_METRICS[config.finalSort]+' '+(config.finalDirection==='asc'?'升序':'降序')}`,`筛选：${(Object.keys(TUNING_FILTERS) as FilterKey[]).map(k=>`${TUNING_FILTERS[k]}=${config.filters[k]??'不限'}`).join('；')}`,`实际分配：${TUNING_CHANNELS.map(k=>`${discoveryChannelLabels[k]} ${result.allocation[k].selected} 个`).join(' / ')}`,`候选路径：${result.sourceCount} 去重 → ${result.scopeCount} 范围内 → ${result.filteredCount} 通过数值筛选 → ${result.rows.length} 入选`,...result.rows.map(r=>`${r.rank}. ${r.token.symbol||'未命名'} | ${r.token.chain} | ${r.token.address} | 分配通道：${discoveryChannelLabels[r.assignedChannel]} | 后端批次状态：${r.token.selection_state}`)].join('\n');
}

export function importTuningRun(raw:unknown):{snapshot:DiscoveryResearchData;form:TuningForm;name:string;notes:string} {
 const root=object(raw);if(root.schema_version!==1||root.algorithm!=='discovery-local-weighted-cycle-v1'||root.experiment_only!==true)throw new Error('不支持的评审文件格式');
 const rawSnapshot=object(root.snapshot);if(!Array.isArray(rawSnapshot.candidates)||rawSnapshot.candidates.length>450)throw new Error('候选快照必须为至多 450 个地址');
 const snapshot=normalizeDiscoveryResearch({research:rawSnapshot});
 if(!Number.isSafeInteger(snapshot.generated_at_ms)||snapshot.generated_at_ms<=0||snapshot.generated_at_ms>8640000000000000)throw new Error('批次时间无效');
 if(new Set(snapshot.candidates.map(id)).size!==snapshot.candidates.length)throw new Error('候选地址重复');
 for(const count of [snapshot.source_row_count,snapshot.unique_count,snapshot.qualified_count,snapshot.selected_count])if(!Number.isSafeInteger(count)||count<0)throw new Error('候选计数无效');
 if(snapshot.source_row_count<snapshot.unique_count||snapshot.source_row_count>450||snapshot.qualified_count>snapshot.unique_count||snapshot.selected_count>snapshot.qualified_count)throw new Error('候选计数不一致');
 const rawConfig=object(root.config),base=defaultTuningForm(snapshot),form:TuningForm={...base,scope:rawConfig.scope as TuningForm['scope'],chain:rawConfig.chain as string,limit:String(rawConfig.limit),finalSort:rawConfig.finalSort as TuningForm['finalSort'],finalDirection:rawConfig.finalDirection as Direction,weights:Object.fromEntries(TUNING_CHANNELS.map(k=>[k,typeof object(rawConfig.weights)[k]==='number'?String(object(rawConfig.weights)[k]):'invalid'])) as TuningForm['weights'],laneSort:rawConfig.laneSort as TuningForm['laneSort'],filters:Object.fromEntries((Object.keys(TUNING_FILTERS) as FilterKey[]).map(k=>[k,object(rawConfig.filters)[k]===undefined?'':typeof object(rawConfig.filters)[k]==='number'?String(object(rawConfig.filters)[k]):'invalid'])) as TuningForm['filters']};
 if(!parseTuningForm(form).config)throw new Error('评审文件参数无效');
 return {snapshot,form,name:typeof root.name==='string'?root.name.slice(0,120):'导入方案',notes:typeof root.notes==='string'?root.notes.slice(0,2000):''};
}
