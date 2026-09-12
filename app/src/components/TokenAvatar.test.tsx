// @vitest-environment jsdom

import {fireEvent, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';

import {TokenAvatarView, selectTokenBadge} from './TokenAvatar';
import type {TokenInfo} from '@/api/token-metadata';

const info = (overrides: Partial<TokenInfo> = {}): TokenInfo => ({
  chain: 'bsc', address: '0xabc', decimals: 18, symbol: 'ABC', is_verify: false,
  launchpad_name: 'PumpFun', launchpad_logo: 'https://images.test/pump.png', ...overrides,
});

describe('TokenAvatar badge precedence', () => {
  it.each([
    [info({is_verify: true}), true, 'verified'],
    [info(), true, 'favorite'],
    [info(), false, 'launchpad'],
    [info({launchpad_logo: undefined}), false, undefined],
    [undefined, true, undefined],
  ] as Array<[TokenInfo | undefined, boolean, string | undefined]>)
  ('chooses one badge for %#', (token, favorite, kind) => {
    expect(selectTokenBadge(token, favorite)?.kind).toBe(kind);
  });

  it('matches the reference layout and hides a failed launchpad badge', () => {
    const view = render(<TokenAvatarView info={info()} isFavorited={false} size={44} />);
    const badge = view.container.querySelector('[data-token-badge="launchpad"]');
    expect(badge).not.toBeNull();
    expect((badge as HTMLElement).style.width).toBe('18px');
    fireEvent.error(badge!.querySelector('img')!);
    expect(view.container.querySelector('[data-token-badge]')).toBeNull();
  });

  it('does not show favorite or launchpad while viewer state is being refreshed', () => {
    const view = render(<TokenAvatarView info={info()} isFavorited personalReady={false} />);
    expect(view.container.querySelector('[data-token-badge]')).toBeNull();
    view.rerender(<TokenAvatarView info={info({is_verify: true})} isFavorited personalReady={false} />);
    expect(view.container.querySelector('[data-token-badge="verified"]')).not.toBeNull();
  });

  it('falls back from canonical artwork to domain artwork and then the symbol', () => {
    const view = render(<TokenAvatarView info={info({logo: 'https://images.test/canonical.png', launchpad_logo: undefined})}
      isFavorited={false} fallbackLogo="https://images.test/fallback.png" fallbackSymbol="F" />);
    const image = () => view.container.querySelector('[role="img"] > span > img') as HTMLImageElement | null;
    expect(image()?.src).toContain('canonical.png');
    fireEvent.error(image()!);
    expect(image()?.src).toContain('fallback.png');
    fireEvent.error(image()!);
    expect(screen.getByText('A')).toBeTruthy();
  });
});

afterEach(() => document.body.replaceChildren());
