// @vitest-environment jsdom
import React from 'react';
import {afterEach, expect, it} from 'vitest';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {normalizeTokenOverview} from '@/lib/token-overview';
import {TokenOverviewContent} from './TokenOverviewTab';

afterEach(cleanup);
it('shows persistent descriptions and translations with no live profile timestamp and keeps original choice on refresh', () => {
  const data=normalizeTokenOverview({chain:'solana',address:'A',profile:{description:'Original 👩‍💻',quality:{state:2,source:'token_descriptions',definition_version:'overview-v1'},description_translation:{status:'ready',target_locale:'zh-Hans',translated_text:'译文 👩‍💻'}}},'solana','A');
  const view=render(<TokenOverviewContent chain="solana" address="A" data={data} now={Date.now()} language="zh-Hans" />);
  expect(screen.getByText('译文 👩‍💻')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'查看原文'}));
  view.rerender(<TokenOverviewContent chain="solana" address="A" data={{...data}} now={Date.now()+1_000_000} language="zh-Hans" />);
  expect(screen.getByText('Original 👩‍💻')).toBeTruthy();
});
