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
  profile: {
    website: string | null;
    twitter: string | null;
    telegram: string | null;
    description: string | null;
    quality: OverviewQuality;
  };
  activity: {volume_5m_usd: number | null; buyers_1h: number | null; sellers_1h: number | null; quality: OverviewQuality};
  holder_summary: {top10_percent: number | null; quality: OverviewQuality};
  holder_intelligence: {
    dev_held_percent: number | null;
    sniper_count: number | null;
    sniper_held_percent: number | null;
    insider_count: number | null;
    insider_held_percent: number | null;
    bundler_count: number | null;
    bundler_held_percent: number | null;
    suspicious_count: number | null;
    suspicious_held_percent: number | null;
    top10_percent: number | null;
    quality: OverviewQuality;
  };
  risk: {
    result_is_scam: boolean | null;
    token_is_scam: boolean | null;
    potential_scam_reasons: string[];
    quality: OverviewQuality;
  };
  contract_status: {
    mint_authority: string | null;
    mintable_valid: boolean | null;
    freeze_authority: string | null;
    freezable_valid: boolean | null;
    b20_transfer_paused: boolean | null;
    b20_mint_paused: boolean | null;
    b20_burn_paused: boolean | null;
    quality: OverviewQuality;
  };
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

function percentage(value: unknown): number | null {
  const number = nonnegative(value);
  return number !== null && number <= 100 ? number : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function boundedIdentifier(value: unknown, maxLength = 256): string | null {
  // UTF-16 length is constant-time and caps work before trim, spread or Unicode scans.
  if (typeof value !== 'string' || value.length > maxLength * 2 || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
  const trimmed = value.trim();
  return trimmed && [...trimmed].length <= maxLength ? trimmed : null;
}

/** Codex descriptions are untrusted text. Keep useful line breaks, reject controls and cap rendered input. */
export function overviewDescription(value: unknown): string | null {
  // Cap raw UTF-16 input before replacements and code-point iteration.
  if (typeof value !== 'string' || value.length > 8_192) return null;
  const normalized = value.replace(/\r\n/g, '\n');
  // Only tab and LF are accepted controls. A lone CR is malformed rather than silently rewritten.
  if (normalized.includes('\r') || /[\p{Cc}\p{Cf}]/u.test(normalized.replace(/[\n\t]/g, ''))) return null;
  const trimmed = normalized.trim();
  if (!trimmed) return null;
  const characters = [...trimmed];
  return characters.length > 2_000 ? characters.slice(0, 2_000).join('') : trimmed;
}

function potentialScamReasons(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const reasons: string[] = [];
  const seen = new Set<string>();
  // Bound inspected input as well as accepted output; malformed prefixes cannot force an unbounded scan.
  const inspectedItems = Math.min(value.length, 64);
  for (let index = 0; index < inspectedItems; index += 1) {
    const item = value[index];
    const reason = boundedIdentifier(item, 128);
    if (reason === null || seen.has(reason)) continue;
    seen.add(reason);
    reasons.push(reason);
    if (reasons.length === 32) break;
  }
  return reasons;
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
  // Reject oversized UTF-16 input before TextEncoder performs byte work.
  if (typeof value !== 'string' || !value || value.length > 2_048 || /[\p{Cc}\p{Cf}]/u.test(value) || new TextEncoder().encode(value).length > 2_048) return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname && !url.username && !url.password && url.href.length <= 2_048
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
  const intelligence = record(value.holder_intelligence);
  const risk = record(value.risk);
  const contract = record(value.contract_status);
  const route = record(value.trading_route_display);
  const label = boundedIdentifier(route.label, 128);
  const configured = route.kind === 'display_only' && route.status === 'configured'
    && label !== null;
  return {
    ...expected,
    profile: {
      website: overviewLink(profile.website),
      twitter: overviewLink(profile.twitter),
      telegram: overviewLink(profile.telegram),
      description: overviewDescription(profile.description),
      quality: quality(profile.quality, 'codex.filterTokens'),
    },
    activity: {
      volume_5m_usd: nonnegative(activity.volume_5m_usd),
      buyers_1h: count(activity.buyers_1h),
      sellers_1h: count(activity.sellers_1h),
      quality: quality(activity.quality, 'codex.filterTokens'),
    },
    holder_summary: {top10_percent: percentage(holder.top10_percent), quality: quality(holder.quality, 'codex.holders')},
    holder_intelligence: {
      dev_held_percent: percentage(intelligence.dev_held_percent),
      sniper_count: count(intelligence.sniper_count),
      sniper_held_percent: percentage(intelligence.sniper_held_percent),
      insider_count: count(intelligence.insider_count),
      insider_held_percent: percentage(intelligence.insider_held_percent),
      bundler_count: count(intelligence.bundler_count),
      bundler_held_percent: percentage(intelligence.bundler_held_percent),
      suspicious_count: count(intelligence.suspicious_count),
      suspicious_held_percent: percentage(intelligence.suspicious_held_percent),
      top10_percent: percentage(intelligence.top10_percent),
      quality: quality(intelligence.quality, 'codex.filterTokens'),
    },
    risk: {
      result_is_scam: nullableBoolean(risk.result_is_scam),
      token_is_scam: nullableBoolean(risk.token_is_scam),
      potential_scam_reasons: potentialScamReasons(risk.potential_scam_reasons),
      quality: quality(risk.quality, 'codex.filterTokens'),
    },
    contract_status: {
      mint_authority: boundedIdentifier(contract.mint_authority),
      mintable_valid: nullableBoolean(contract.mintable_valid),
      freeze_authority: boundedIdentifier(contract.freeze_authority),
      freezable_valid: nullableBoolean(contract.freezable_valid),
      b20_transfer_paused: nullableBoolean(contract.b20_transfer_paused),
      b20_mint_paused: nullableBoolean(contract.b20_mint_paused),
      b20_burn_paused: nullableBoolean(contract.b20_burn_paused),
      quality: quality(contract.quality, 'codex.filterTokens'),
    },
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
