import {expect,it,vi} from 'vitest';
import {createOverviewRequests} from './overview-requests';
import {fetchTokenOverview} from './market';
import type {TokenOverview} from './token-overview';
import type {ContentLanguage} from './content-translation';

it('does not deduplicate different languages and cancels only the departing language',async()=>{
  vi.useFakeTimers();
  try {
    const settle=new Map<string,(v:TokenOverview)=>void>();
    const fetcher=vi.fn((_c:string,_a:string,_s:AbortSignal,l:ContentLanguage)=>new Promise<TokenOverview>(resolve=>{settle.set(l,resolve);}));
    const pool=createOverviewRequests(fetcher),leaveEn=pool.retain('solana','A','en'),leaveJa=pool.retain('solana','A','ja');
    const en=pool.run('solana','A','en'),ja=pool.run('solana','A','ja');
    const rejected=expect(en).rejects.toMatchObject({name:'AbortError'});
    await Promise.resolve();expect(fetcher).toHaveBeenCalledTimes(2);
    leaveEn();await vi.advanceTimersByTimeAsync(1);
    expect(fetcher.mock.calls[0][2].aborted).toBe(true);expect(fetcher.mock.calls[1][2].aborted).toBe(false);
    settle.get('ja')!({address:'A'} as TokenOverview);await expect(ja).resolves.toMatchObject({address:'A'});
    settle.get('en')!({address:'late'} as TokenOverview);await rejected;leaveJa();await vi.runAllTimersAsync();
  }finally{vi.useRealTimers();}
});

it('Overview sends explicit language and preserves original plus attached translation',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({code:200,data:{chain:'solana',address:'A',profile:{description:'Original',description_translation:{status:'ready',target_locale:'ja',translated_text:'日本語'}}}})));
  vi.stubGlobal('fetch',fetcher);
  try {
    const result=await fetchTokenOverview('solana','A',undefined,'ja');
    expect(fetcher.mock.calls[0][1].headers['Accept-Language']).toBe('ja');
    expect(result.profile).toMatchObject({description:'Original',translation:{targetLocale:'ja',translatedText:'日本語'}});
  }finally{vi.unstubAllGlobals();}
});
