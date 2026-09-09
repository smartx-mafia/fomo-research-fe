/** Consumer contract for the cache-only /overview endpoint. Never coerce unknown into 0. */
export type OverviewQuality = {
  state: 0 | 1 | 2;
  freshness: 0 | 1 | 2;
  source: string;
  definition_version: string;
  observed_at_ms: number | null;
};

export type TokenOverview = {
  chain: string;
  address: string;
  profile: {website: string | null; twitter: string | null; quality: OverviewQuality};
  activity: {volume_5m_usd: number | null; buyers_1h: number | null; sellers_1h: number | null; quality: OverviewQuality};
  holder_summary: {top10_percent: number | null; quality: OverviewQuality};
  trading_route_display: {label: string | null; kind: 'display_only'; status: 'configured' | 'unavailable'};
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function nonnegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function count(value: unknown): number | null {
  const number = nonnegative(value);
  return number !== null && Number.isSafeInteger(number) ? number : null;
}

function quality(value: unknown, source: string): OverviewQuality {
  const raw = record(value);
  const known = raw.definition_version === 'overview-v1' && raw.source === source;
  const observedAt = count(raw.observed_at_ms);
  return {
    state: known && (raw.state === 1 || raw.state === 2) ? raw.state : 0,
    freshness: known && (raw.freshness === 1 || raw.freshness === 2) ? raw.freshness : 0,
    source: typeof raw.source === 'string' ? raw.source : '',
    definition_version: typeof raw.definition_version === 'string' ? raw.definition_version : '',
    observed_at_ms: observedAt !== null && observedAt > 0 ? observedAt : null,
  };
}

/** These are external links, never HTML or fetch targets. Defense in depth at the href boundary. */
export function overviewLink(value: unknown): string | null {
  if (typeof value !== 'string' || !value || new TextEncoder().encode(value).length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname && !url.username && !url.password
      ? url.href : null;
  } catch {
    return null;
  }
}

export function overviewIdentity(chain: string, address: string) {
  return {chain, address: chain === 'solana' ? address : address.toLowerCase()};
}

export function normalizeTokenOverview(raw: unknown, chain: string, address: string): TokenOverview {
  const value = record(raw);
  const expected = overviewIdentity(chain, address);
  if (value.chain !== expected.chain || value.address !== expected.address) {
    throw new Error('Overview response does not match the requested token.');
  }
  const profile = record(value.profile);
  const activity = record(value.activity);
  const holder = record(value.holder_summary);
  const route = record(value.trading_route_display);
  const top10 = nonnegative(holder.top10_percent);
  const label = typeof route.label === 'string' ? route.label.trim() : '';
  const configured = route.kind === 'display_only' && route.status === 'configured'
    && label.length > 0 && [...label].length <= 128 && !/[\u0000-\u001f\u007f]/.test(label);
  return {
    ...expected,
    profile: {website: overviewLink(profile.website), twitter: overviewLink(profile.twitter), quality: quality(profile.quality, 'codex.filterTokens')},
    activity: {
      volume_5m_usd: nonnegative(activity.volume_5m_usd),
      buyers_1h: count(activity.buyers_1h),
      sellers_1h: count(activity.sellers_1h),
      quality: quality(activity.quality, 'codex.filterTokens'),
    },
    holder_summary: {top10_percent: top10 !== null && top10 <= 100 ? top10 : null, quality: quality(holder.quality, 'codex.holders')},
    trading_route_display: {label: configured ? label : null, kind: 'display_only', status: configured ? 'configured' : 'unavailable'},
  };
}

export type OverviewStatus = 'fresh' | 'stale' | 'unavailable';

/** Re-evaluate cached snapshots locally, even when a refresh fails or the device was asleep. */
export function overviewStatus(quality: OverviewQuality | undefined, now: number, holder = false): OverviewStatus {
  if (!quality || quality.state === 0 || quality.freshness === 0 || quality.definition_version !== 'overview-v1' || quality.observed_at_ms === null) return 'unavailable';
  const age = now - quality.observed_at_ms;
  if (age < 0 || age >= 300_000) return 'unavailable';
  return quality.freshness === 2 || (!holder && age > 60_000) ? 'stale' : 'fresh';
}

export function overviewPollDelay(random = Math.random()): number {
  return 30_000 + Math.floor(Math.min(1, Math.max(0, random)) * 6_000) - 3_000;
}
