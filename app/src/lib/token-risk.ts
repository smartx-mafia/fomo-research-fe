/** Canonical frontend representation shared by every token-data surface. */
export type TokenRiskLevel = 'UNKNOWN' | 'NO_FLAG_REPORTED' | 'POTENTIAL' | 'SCAM';

export type TokenRiskQuality = {
  state: 'UNAVAILABLE' | 'AVAILABLE' | 'PARTIAL';
  freshness: 'UNKNOWN' | 'FRESH' | 'STALE';
  source: string;
  definitionVersion: string;
  /** Protobuf int64 stays an exact decimal string. */
  observedAtMs: string | null;
};

export type TokenRisk = {
  resultIsScam: boolean | null;
  tokenIsScam: boolean | null;
  potentialScamReasons: string[];
  level: TokenRiskLevel;
  quality: TokenRiskQuality;
};

export type TokenRiskStatus = 'fresh' | 'stale' | 'unavailable';

type NormalizeTokenRiskOptions = {
  /** Transitional TokenMarket/SearchTokenMarket object with flat risk fields. */
  flat?: unknown;
  /** market.updated_at, used only by the flat compatibility path. */
  observedAtMs?: unknown;
};

const MAX_INT64 = '9223372036854775807';
const FLAT_RISK_FIELDS = [
  'result_is_scam',
  'token_is_scam',
  'potential_scam_reasons',
  'risk_observed',
] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function field(value: Record<string, unknown>, camel: string, snake: string): unknown {
  if (hasOwn(value, camel)) return value[camel];
  return value[snake];
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function boundedIdentifier(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string' || value.length > maxLength * 2 || /[\p{Cc}\p{Cf}]/u.test(value)) return undefined;
  const trimmed = value.trim();
  return trimmed && [...trimmed].length <= maxLength ? trimmed : undefined;
}

function potentialScamReasons(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const reasons: string[] = [];
  const seen = new Set<string>();
  const inspectedItems = Math.min(value.length, 64);
  for (let index = 0; index < inspectedItems; index += 1) {
    const reason = boundedIdentifier(value[index], 128);
    if (!reason || seen.has(reason)) continue;
    seen.add(reason);
    reasons.push(reason);
    if (reasons.length === 32) break;
  }
  return reasons;
}

function observedAt(value: unknown): string | null {
  let raw: string;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    raw = String(value);
  } else if (typeof value === 'string' && /^\d{1,20}$/.test(value)) {
    raw = value.replace(/^0+/, '') || '0';
    if (raw === '0') return null;
  } else {
    return null;
  }
  return raw.length < MAX_INT64.length || (raw.length === MAX_INT64.length && raw <= MAX_INT64)
    ? raw
    : null;
}

function riskState(value: unknown): TokenRiskQuality['state'] {
  if (value === 1 || value === 'AVAILABLE' || value === 'TOKEN_RISK_STATE_AVAILABLE') return 'AVAILABLE';
  if (value === 2 || value === 'PARTIAL' || value === 'TOKEN_RISK_STATE_PARTIAL') return 'PARTIAL';
  return 'UNAVAILABLE';
}

function riskFreshness(value: unknown): TokenRiskQuality['freshness'] {
  if (value === 1 || value === 'FRESH' || value === 'TOKEN_RISK_FRESHNESS_FRESH') return 'FRESH';
  if (value === 2 || value === 'STALE' || value === 'TOKEN_RISK_FRESHNESS_STALE') return 'STALE';
  return 'UNKNOWN';
}

function riskLevel(value: unknown): TokenRiskLevel | undefined {
  if (value === 0) return 'UNKNOWN';
  if (value === 1) return 'NO_FLAG_REPORTED';
  if (value === 2) return 'POTENTIAL';
  if (value === 3) return 'SCAM';
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/^TOKEN_RISK_LEVEL_/, '');
  return normalized === 'UNKNOWN' || normalized === 'NO_FLAG_REPORTED' || normalized === 'POTENTIAL' || normalized === 'SCAM'
    ? normalized
    : undefined;
}

function unavailableQuality(): TokenRiskQuality {
  return {state: 'UNAVAILABLE', freshness: 'UNKNOWN', source: '', definitionVersion: '', observedAtMs: null};
}

export function unavailableTokenRisk(): TokenRisk {
  return {
    resultIsScam: null,
    tokenIsScam: null,
    potentialScamReasons: [],
    level: 'UNKNOWN',
    quality: unavailableQuality(),
  };
}

function normalizeQuality(rawRisk: Record<string, unknown>): TokenRiskQuality {
  const raw = record(rawRisk.quality);
  if (!raw) return unavailableQuality();

  const state = riskState(raw.state);
  const freshness = riskFreshness(raw.freshness);
  const source = boundedIdentifier(raw.source, 128) ?? '';
  const definitionVersion = boundedIdentifier(field(raw, 'definitionVersion', 'definition_version'), 128) ?? '';
  const observedAtMs = observedAt(field(raw, 'observedAtMs', 'observed_at_ms'));
  const usable = source === 'codex.filterTokens'
    && (definitionVersion === 'overview-v1' || definitionVersion === 'token-risk-v2')
    && (state === 'AVAILABLE' || state === 'PARTIAL')
    && (freshness === 'FRESH' || freshness === 'STALE')
    && observedAtMs !== null;
  return {
    state: usable ? state : 'UNAVAILABLE',
    freshness: usable ? freshness : 'UNKNOWN',
    source,
    definitionVersion,
    observedAtMs,
  };
}

function deriveLevel(
  resultIsScam: boolean | null,
  tokenIsScam: boolean | null,
  reasons: string[],
  quality: TokenRiskQuality,
  provided?: TokenRiskLevel,
): TokenRiskLevel {
  if (resultIsScam === true || tokenIsScam === true || provided === 'SCAM') return 'SCAM';
  if (reasons.length > 0 || provided === 'POTENTIAL') return 'POTENTIAL';
  if (quality.state === 'UNAVAILABLE') return 'UNKNOWN';
  return 'NO_FLAG_REPORTED';
}

function normalizeNestedRisk(raw: Record<string, unknown>): TokenRisk {
  const resultIsScam = nullableBoolean(field(raw, 'resultIsScam', 'result_is_scam'));
  const tokenIsScam = nullableBoolean(field(raw, 'tokenIsScam', 'token_is_scam'));
  const reasons = potentialScamReasons(field(raw, 'potentialScamReasons', 'potential_scam_reasons'));
  const quality = normalizeQuality(raw);
  return {
    resultIsScam,
    tokenIsScam,
    potentialScamReasons: reasons,
    level: deriveLevel(resultIsScam, tokenIsScam, reasons, quality, riskLevel(raw.level)),
    quality,
  };
}

function normalizeFlatRisk(raw: Record<string, unknown>, observedAtMs: unknown): TokenRisk {
  const resultIsScam = nullableBoolean(raw.result_is_scam);
  const tokenIsScam = nullableBoolean(raw.token_is_scam);
  const reasons = potentialScamReasons(raw.potential_scam_reasons);
  const observed = raw.risk_observed === true;
  const quality: TokenRiskQuality = {
    state: observed ? 'AVAILABLE' : 'UNAVAILABLE',
    freshness: observed ? 'FRESH' : 'UNKNOWN',
    source: 'codex.filterTokens',
    definitionVersion: '',
    observedAtMs: observedAt(observedAtMs),
  };
  return {
    resultIsScam,
    tokenIsScam,
    potentialScamReasons: reasons,
    level: deriveLevel(resultIsScam, tokenIsScam, reasons, quality),
    quality,
  };
}

/**
 * Nested canonical risk is authoritative. During rollout, absent nested risk may
 * be adapted from TokenMarket/SearchTokenMarket's flat fields. No risk evidence
 * at either location always becomes UNKNOWN + UNAVAILABLE.
 */
export function normalizeTokenRisk(value: unknown, options: NormalizeTokenRiskOptions = {}): TokenRisk {
  const nested = record(value);
  if (nested) return normalizeNestedRisk(nested);

  const flat = record(options.flat);
  if (!flat || !FLAT_RISK_FIELDS.some((key) => hasOwn(flat, key))) return unavailableTokenRisk();
  return normalizeFlatRisk(flat, options.observedAtMs);
}

/** Same 60-second stale / 300-second expiry policy as the Overview risk card. */
export function tokenRiskStatus(risk: TokenRisk | undefined, now: number): TokenRiskStatus {
  if (!risk || risk.quality.state === 'UNAVAILABLE' || risk.quality.observedAtMs === null) return 'unavailable';
  const observed = Number(risk.quality.observedAtMs);
  if (!Number.isSafeInteger(observed)) return 'unavailable';
  const age = now - observed;
  if (age < 0 || age >= 300_000) return 'unavailable';
  return risk.quality.freshness === 'STALE' || age > 60_000 ? 'stale' : 'fresh';
}
