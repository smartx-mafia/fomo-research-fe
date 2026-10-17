// @vitest-environment jsdom
import React from 'react';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {DiscoveryTuning} from './DiscoveryTuning';
import type {DiscoveryResearchData} from '@/lib/discovery';
const now=1792150000000;
const batch=(address='OLD',at=now):DiscoveryResearchData=>({generated_at_ms:at,state:'complete',source_row_count:2,unique_count:2,qualified_count:1,selected_count:1,discovery:{policy_version:'codex-five-lane-v3',state:'complete',market_mode:'snapshot',channels:[],weights:{hot_5m:20,volume_spike:15,new_tokens:50,price_up:10,hot_24h:5}},candidates:[{chain:'bsc',address,symbol:address,name:address,selection_state:'selected',exclusion_reason:'',liquidity:50000,volume_5m:3000,buyers_5m:20,fdv:1000000,sources:[{code:'new_tokens',label:'新币起势',metric:'token_created_at',unit:'unix_ms',value:at-3600000,observed_at_ms:at,upstream_rank:1}]},{chain:'solana',address:'REJECTED',symbol:'REJECTED',name:'rejected',selection_state:'risk_excluded',exclusion_reason:'risk',liquidity:50000,volume_5m:5000,buyers_5m:20,sources:[{code:'hot_5m',label:'短期热门',metric:'upstream_rank',unit:'rank',value:1,upstream_rank:1}]}]});
const clipboard=vi.fn().mockResolvedValue(undefined);
beforeEach(()=>{localStorage.clear();Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:clipboard}});vi.stubGlobal('fetch',vi.fn());});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();});
it('权重输入校验，合法后本地即时预览，不发送请求',()=>{
 render(<DiscoveryTuning data={batch()}/>);
 expect(within(screen.getByRole('table',{name:'模拟榜单'})).getByText('OLD · bsc')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('新币起势权重'),{target:{value:'60'}});
 expect(screen.getByRole('alert').textContent).toContain('100%');expect(screen.queryByRole('table',{name:'模拟榜单'})).toBeNull();expect((screen.getByRole('button',{name:'导出方案与候选快照'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText('短期热门权重'),{target:{value:'10'}});expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByRole('table',{name:'模拟榜单'})).toBeTruthy();expect(fetch).not.toHaveBeenCalled();
});
it('刷新props不更换锁定批次，采用最新批次保留参数',()=>{
 const {rerender}=render(<DiscoveryTuning data={batch()}/>);fireEvent.change(screen.getByLabelText('模拟榜单数量'),{target:{value:'5'}});
 rerender(<DiscoveryTuning data={batch('NEW',now+60000)}/>);
 expect(screen.getByText('OLD · bsc')).toBeTruthy();expect(screen.queryByText('NEW · bsc')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'采用最新已读取批次'}));expect(screen.getByText('NEW · bsc')).toBeTruthy();expect((screen.getByLabelText('模拟榜单数量') as HTMLInputElement).value).toBe('5');
});
it('可以保存加载方案并复制包含批次和完整结果的PM摘要',async()=>{
 render(<DiscoveryTuning data={batch()}/>);
 fireEvent.change(screen.getByLabelText('方案名称'),{target:{value:'产品评审 A'}});fireEvent.change(screen.getByLabelText('方案备注'),{target:{value:'观察新币占比'}});
 fireEvent.click(screen.getByRole('button',{name:'保存方案到本机'}));const saved=JSON.parse(localStorage.getItem('smartx.discovery-tuning.plans.v1')!);expect(saved).toHaveLength(1);expect(saved[0].form.weights.new_tokens).toBe('50');
 fireEvent.change(screen.getByLabelText('新币起势权重'),{target:{value:'1'}});fireEvent.change(screen.getByLabelText('已保存方案'),{target:{value:saved[0].id}});expect((screen.getByLabelText('新币起势权重') as HTMLInputElement).value).toBe('50');
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'复制评审摘要'})));
 expect(clipboard).toHaveBeenCalledWith(expect.stringContaining('产品评审 A'));expect(clipboard).toHaveBeenCalledWith(expect.stringContaining('OLD'));expect(screen.getByLabelText('评审摘要')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('模拟候选范围'),{target:{value:'all'}});expect(screen.getByText('REJECTED · solana')).toBeTruthy();expect(screen.getByText(/所有结果仅用于研究/)).toBeTruthy();
});

it('导入评审文件恢复快照与参数，并重新计算预览',async()=>{
 const {defaultTuningForm,parseTuningForm,simulateDiscovery,exportTuningRun}=await import('@/lib/discovery-tuning');
 const importedBatch=batch('IMPORTED',now-60000);const form=defaultTuningForm(importedBatch);form.limit='3';const config=parseTuningForm(form).config!;const fileData=exportTuningRun(importedBatch,config,'PM导入','同一批次',simulateDiscovery(importedBatch,config));
 render(<DiscoveryTuning data={batch()}/>);
 await act(async()=>fireEvent.change(screen.getByLabelText('导入评审文件'),{target:{files:[{size:2000,text:async()=>JSON.stringify(fileData)}]}}));
 expect(screen.getByText('IMPORTED · bsc')).toBeTruthy();expect((screen.getByLabelText('模拟榜单数量') as HTMLInputElement).value).toBe('3');expect(screen.getByText(/导入评审文件（本地数据）/)).toBeTruthy();
 expect(fetch).not.toHaveBeenCalled();
});
