import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

function source(name: string) {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

describe('token avatar coverage boundary', () => {
  it('keeps the Token-data WS discovery list out of metadata badge hydration', () => {
    const table = source('./TokenTable.tsx');
    expect(table).not.toContain('TokenAvatar');
    expect(table).not.toContain('ensureMetadata');
    expect(table).toContain('ensureStatus');
  });

  it('routes non-WS token identity surfaces through the shared avatar', () => {
    for (const file of [
      './TokenHeader.tsx',
      './SearchBox.tsx',
      './WatchlistPanel.tsx',
      './PortfolioTokenIdentity.tsx',
      './PortfolioActivity.tsx',
      './DepositAddresses.tsx',
      './SweepDepositCard.tsx',
      './SquareOpinionCard.tsx',
      './SmartMoneyProfile.tsx',
    ]) {
      expect(source(file), `${file} must use the canonical TokenAvatar`).toMatch(/TokenAvatar(?:View)?/);
    }
  });
});
