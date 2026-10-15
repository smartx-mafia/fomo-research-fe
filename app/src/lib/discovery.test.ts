import {expect, it} from 'vitest';
import {normalizeDiscovery, normalizeDiscoveryCoverage, discoveryReasonDetail} from './discovery';
it('保留多路理由、零值与缺失值的区别，不依据实时行情推断理由', () => {
 const d=normalizeDiscovery({channels:['hot_5m','price_up'],volume_5m:'0',discovered_at_ms:'123',reasons:[{code:'hot_5m',label:'短期热门',metric:'upstream_rank',value:null,threshold:100},{code:'price_up',label:'上涨异动',metric:'price_change_5m',value:'5.2',threshold:'5',unit:'percent',observed_at_ms:'123'}]});
 expect(d?.reasons).toHaveLength(2); expect(d?.volume_5m).toBe(0); expect(d?.reasons[0].value).toBeUndefined(); expect(discoveryReasonDetail(d!.reasons[1])).toBe('5 分钟涨幅 5.2%，门槛 ≥ 5%');
 expect(normalizeDiscovery({reasons:[{code:'x',label:'X',value:false} ]})?.reasons[0].value).toBeUndefined();
 expect(normalizeDiscoveryCoverage({})).toBeUndefined();
});
