// @vitest-environment jsdom
import React from 'react';
import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {TranslatedText} from './TranslatedText';
import {normalizeContentTranslation} from '@/lib/content-translation';

afterEach(() => {cleanup(); vi.unstubAllGlobals();});
const translation = normalizeContentTranslation({status:'ready',target_locale:'en',translated_text:'Translated body'});

it('defaults to translation, toggles locally, preserves choice on refresh and resets on version/language changes', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const view = render(<TranslatedText identity="1:2" original="原文" translation={translation} language="en" />);
  expect(screen.getByText('Translated body')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name:'查看原文'}));
  expect(screen.getByText('原文')).toBeTruthy();
  view.rerender(<TranslatedText identity="1:2" original="原文" translation={{...translation!,translatedText:'Refreshed body'}} language="en" />);
  expect(screen.getByText('原文')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name:'查看译文'}));
  expect(screen.getByText('Refreshed body')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', {name:'查看原文'}));
  view.rerender(<TranslatedText identity="1:3" original="新原文" translation={translation} language="en" />);
  expect(screen.getByText('Translated body')).toBeTruthy();
  view.rerender(<TranslatedText identity="1:3" original="新原文" translation={translation} language="ja" />);
  expect(screen.getByText('新原文')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it('renders pending/failed/null/mismatched languages as original with no toggle', () => {
  const view=render(<TranslatedText identity="a" original="Original" language="en" />);
  for (const value of [undefined, ...(['pending','failed','stale','unavailable','unsupported','original'] as const).map(status=>({...translation!,status})), {...translation!,targetLocale:'ja'}]) {
    view.rerender(<TranslatedText identity="a" original="Original" language="en" translation={value} />);
    expect(screen.getByText('Original')).toBeTruthy(); expect(screen.queryByRole('button')).toBeNull();
  }
});

it('escapes markup, retains full emoji text, and keeps the toggle outside the body navigation button', () => {
  const open=vi.fn(),parent=vi.fn();
  const text='<script>bad()</script>\n👩🏽‍💻\t'+ '长'.repeat(2200);
  const view=render(<div onClick={parent}><TranslatedText identity="a" original="Original" language="en" translation={{...translation!,translatedText:text}} onOpen={open} openLabel="Open position" /></div>);
  expect(view.container.querySelector('script')).toBeNull();
  expect(screen.getByRole('button',{name:'Open position'}).textContent).toBe(text);
  expect(view.container.querySelector('button button')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'查看原文'}));
  expect(open).not.toHaveBeenCalled(); expect(parent).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Open position'}));expect(open).toHaveBeenCalledTimes(1);
});
