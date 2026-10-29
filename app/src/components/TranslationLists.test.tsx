// @vitest-environment jsdom
import React, {act} from 'react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {SWRConfig} from 'swr';

const control=vi.hoisted(()=>({feed:vi.fn(),opinions:vi.fn(),ensure:vi.fn()}));
vi.mock('@/session/storage',()=>({useSession:()=>null,clearSite:vi.fn()}));
vi.mock('@/hooks/useSquareAuthorRelations',()=>({useSquareAuthorRelations:()=>({entries:{},ensure:control.ensure,toggle:vi.fn()})}));
vi.mock('@/components/TokenAvatar',()=>({TokenAvatar:()=> <span />}));
vi.mock('next/image',()=>({default:({unoptimized:_u,...props}:React.ImgHTMLAttributes<HTMLImageElement>&{unoptimized?:boolean})=><img {...props}/>}));
vi.mock('@/api/social-content',async original=>({...await original<typeof import('@/api/social-content')>(),listSquareFeedPage:control.feed,listTokenOpinions:control.opinions,getSquareFeedUpdates:vi.fn()}));
vi.mock('next/dynamic',()=>({default:()=>()=>null}));
import {SquareFeed} from './SquareFeed';
import TokenOpinionsTab from './TokenOpinionsTab';
import {ContentLanguageSelect} from './ContentLanguageSelect';
import {setContentLanguage} from '@/hooks/useContentLanguage';

function card(targetLocale:string,text:string) {
  return {type:1,sourceID:'1',actorIdentifier:'alice',actor:{identifier:'alice',nickname:'Alice'},sortTime:{seconds:100,nanos:0},content:{kind:'opinion',
    opinion:{opinionID:'1',authorIdentifier:'alice',latestVersion:{versionID:'2',body:'Original opinion',items:[],likeCount:0,publishedAt:{seconds:100,nanos:0},translation:{status:'ready',targetLocale,translatedText:text}}},
    position:{asset:{chain:'bsc',token_address:'0xabc'},shares_raw:'1',symbol:'COIN'},
  }};
}
beforeEach(()=>{vi.clearAllMocks();setContentLanguage(null);vi.spyOn(window,'scrollTo').mockImplementation(()=>{});vi.stubGlobal('requestAnimationFrame',(f:FrameRequestCallback)=>{f(0);return 1;});});
afterEach(()=>{cleanup();setContentLanguage(null);vi.restoreAllMocks();vi.unstubAllGlobals();});

it('Square switches language, aborts the old request and ignores a late response; the toggle never requests again',async()=>{
  let old!:(v:unknown)=>void;
  control.feed.mockImplementation((_lane,{language})=>language==='en'?new Promise(resolve=>{old=resolve;}):Promise.resolve({items:[card(language,'中文译文')]}));
  render(<><ContentLanguageSelect/><SquareFeed initialLane="newest"/></>);
  await waitFor(()=>expect(control.feed).toHaveBeenCalledTimes(1));
  const oldSignal=control.feed.mock.calls[0][1].signal as AbortSignal;
  fireEvent.change(screen.getByRole('combobox',{name:'翻译语言'}),{target:{value:'zh-Hans'}});
  expect(await screen.findByText('中文译文')).toBeTruthy();
  expect(oldSignal.aborted).toBe(true);
  await act(async()=>old({items:[card('en','Late English')]}));
  expect(screen.queryByText('Late English')).toBeNull();
  const calls=control.feed.mock.calls.length;
  fireEvent.click(screen.getByRole('button',{name:'查看原文'}));
  expect(screen.getByText('Original opinion')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'查看译文'}));
  expect(screen.getByText('中文译文')).toBeTruthy();expect(control.feed).toHaveBeenCalledTimes(calls);
});

it('token opinions use the attached version translation and isolate language cache and late results',async()=>{
  let old!:(v:unknown)=>void;
  control.opinions.mockImplementation((_chain,_address,{language})=>language==='en'?new Promise(resolve=>{old=resolve;}):Promise.resolve({items:[card(language,'日本語訳').content]}));
  render(<SWRConfig value={{provider:()=>new Map()}}><ContentLanguageSelect/><TokenOpinionsTab chain="solana" address="A"/></SWRConfig>);
  await waitFor(()=>expect(control.opinions).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByRole('combobox',{name:'翻译语言'}),{target:{value:'ja'}});
  expect(await screen.findByText('日本語訳')).toBeTruthy();
  await act(async()=>old({items:[card('en','Late English').content]}));
  expect(screen.queryByText('Late English')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'查看原文'}));
  expect(screen.getByText('Original opinion')).toBeTruthy();expect(control.opinions).toHaveBeenCalledTimes(2);
});
