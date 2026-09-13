import {readFileSync} from 'node:fs';
import {afterEach, expect, it, vi} from 'vitest';
import {normalizePortfolio, normalizePortfolioClosedPage, normalizePortfolioTradePage} from './portfolio';
import {getUserPortfolioPosition} from './user-portfolio';

afterEach(() => vi.unstubAllGlobals());
it.skipIf(!process.env.PORTFOLIO_SAMPLE_FILE)('accepts captured deployed unified responses', async () => {
  const sample = JSON.parse(readFileSync(process.env.PORTFOLIO_SAMPLE_FILE!, 'utf8'));
  expect(normalizePortfolio(sample.overview).positions.length).toBeGreaterThan(0);
  expect(normalizePortfolioClosedPage(sample.closed).items.length).toBeGreaterThan(0);
  expect(normalizePortfolioTradePage(sample.trades).trades.length).toBeGreaterThan(0);
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({code: 200, data: sample.detail})))));
  expect((await getUserPortfolioPosition('sample-user', sample.scope)).trades.length).toBeGreaterThan(0);
});
