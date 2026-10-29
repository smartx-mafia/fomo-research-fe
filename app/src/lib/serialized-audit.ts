const CHAIN_SYMBOLS = {
  solana: 'SOLANA',
  base: 'BASE',
  bsc: 'BSC',
  ethereum: 'ETH',
  robinhood: 'ROBINHOOD',
  arc: 'ARC',
} as const;

export type SerializedAuditChain = keyof typeof CHAIN_SYMBOLS;

export type SerializedVulnerability = {
  type: string;
  impact: string;
  description: string;
  mitigated: boolean | null;
};

export type SerializedAudit = {
  isSafe: boolean;
  isTokenSafe: boolean | null;
  description: string;
  vulnerabilities: SerializedVulnerability[];
  name: string;
  symbol: string;
  address: string;
  chain: string;
  sourceType: string;
  isProxy: boolean | null;
  createdAt: string;
  auditSystemVersion: string;
};

export type SerializedAuditResult =
  | {state: 'ready'; audit: SerializedAudit}
  | {state: 'unavailable'; reason: string; message: string};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max = 1_000): string {
  return typeof value === 'string' && value.length <= max && !/[\p{Cc}\p{Cf}]/u.test(value) ? value : '';
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function serializedChainSymbol(chain: string): string | undefined {
  return CHAIN_SYMBOLS[chain.trim().toLowerCase() as SerializedAuditChain];
}

export function validSerializedAddress(chain: string, address: string): boolean {
  const candidate = address.trim();
  return chain.trim().toLowerCase() === 'solana'
    ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(candidate)
    : /^0x(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(candidate);
}

export function normalizeSerializedAudit(value: unknown): SerializedAuditResult {
  const raw = record(value);
  if (raw.audit === null) {
    const reason = text(raw.reason, 64);
    if (!reason) throw new Error('Serialized Audit returned an invalid empty result.');
    return {state: 'unavailable', reason, message: text(raw.message) || 'No audit verdict is available.'};
  }

  const audit = record(raw.audit);
  const description = text(audit.description);
  const address = text(audit.address, 128);
  const chain = text(audit.chain, 32);
  if (typeof audit.isSafe !== 'boolean' || !description || !address || !chain || !Array.isArray(audit.vulnerabilities)) {
    throw new Error('Serialized Audit returned an invalid response.');
  }

  const vulnerabilities = audit.vulnerabilities.map(record).flatMap((item) => {
    const type = text(item.type, 128);
    const impact = text(item.impact, 32);
    const detail = text(item.description);
    if (!type || !impact || !detail) return [];
    return [{type, impact, description: detail, mitigated: nullableBoolean(item.mitigated)}];
  });

  return {state: 'ready', audit: {
    isSafe: audit.isSafe,
    isTokenSafe: nullableBoolean(audit.isTokenSafe),
    description,
    vulnerabilities,
    name: text(audit.name, 256),
    symbol: text(audit.symbol, 64),
    address,
    chain,
    sourceType: text(audit.sourceType, 32),
    isProxy: nullableBoolean(audit.isProxy),
    createdAt: text(audit.createdAt, 64),
    auditSystemVersion: text(audit.auditSystemVersion, 64),
  }};
}
