// @vitest-environment jsdom
import React from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const {fetchResearch}=vi.hoisted(()=>({fetchResearch:vi.fn()}));
vi.mock('@/lib/market',async importOriginal=>({...await importOriginal<object>(),fetchDiscoveryResearch:fetchResearch}));
import {DiscoveryResearch} from './DiscoveryResearch';
const batch={generated_at_ms:1792065000000,state:'complete',source_row_count:150,unique_count:130,qualified_count:110,selected_count:100,discovery:{policy_version:'codex-five-lane-v3',state:'complete',market_mode:'snapshot',channels:[],weights:{new_tokens:50,hot_5m:20,volume_spike:15,price_up:10,hot_24h:5}},candidates:Array.from({length:130},(_,i)=>({chain:'bsc',address:`0x${i}`,symbol:`C${i}`,name:'Candidate',selection_state:i<100?'selected':'local_excluded',selected_rank:i<100?i+1:0,exclusion_reason:i<100?'':'未通过本地资格复核',sources:[{code:'new_tokens',label:'新币起势',metric:'token_created_at',unit:'unix_ms',value:1792060000000}]}))};
beforeEach(()=>{vi.useFakeTimers();fetchResearch.mockResolvedValue(batch);});
afterEach(()=>{cleanup();vi.clearAllTimers();vi.useRealTimers();vi.resetAllMocks();});
it('展示超过100的全部地址和被剔除候选，来源与状态只在本地筛选',async()=>{
 render(<DiscoveryResearch/>);await act(async()=>{});
 expect(screen.getAllByRole('row')).toHaveLength(131);expect(screen.getByText('0x129')).toBeTruthy();expect(screen.getByText(/新币起势 50%/)).toBeTruthy();
 fireEvent.change(screen.getByLabelText('筛选状态'),{target:{value:'local_excluded'}});expect(screen.getAllByRole('row')).toHaveLength(31);
 fireEvent.change(screen.getByLabelText('搜索候选'),{target:{value:'0x129'}});expect(screen.getAllByRole('row')).toHaveLength(2);expect(fetchResearch).toHaveBeenCalledTimes(1);
});
it('暂停后不再自动请求，手动刷新仍可用，失败保留并标记旧批次',async()=>{
 render(<DiscoveryResearch/>);await act(async()=>{});
 fireEvent.click(screen.getByRole('button',{name:'暂停自动刷新'}));await act(async()=>vi.advanceTimersByTime(120000));expect(fetchResearch).toHaveBeenCalledTimes(1);
 fetchResearch.mockRejectedValueOnce(new Error('offline'));
 fireEvent.click(screen.getByRole('button',{name:'刷新批次'}));await act(async()=>{});
 expect(fetchResearch).toHaveBeenCalledTimes(2);expect(screen.getByRole('alert').textContent).toContain('保留上次批次');expect(screen.getByText('0x129')).toBeTruthy();
});
