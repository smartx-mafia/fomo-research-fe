/** Backend decisions only. Raw provider evidence must never determine a grade. */
export type RiskItem = {
  code: string;
  grade: number;
  displaySource: string;
  evidence: {source: string; field: string; value: string; observedAtMs: string | null}[];
  params: Record<string, string>;
};
export type RiskAssessment = {
  mode: 'enforce' | 'observe' | '';
  grade: number;
  checksComplete: boolean;
  /** Backend deadline for reusing complete checks; absent/null on legacy or incomplete snapshots. */
  validUntilMs?: string | null;
  policyVersion: string;
  decisionVersion: string;
  confirmationVersion: string;
  items: RiskItem[];
  checks: {code: string; state: string; value: string}[];
  goplusStatus: string;
  goplusObservedAtMs: string | null;
  lastAttemptAtMs: string | null;
  recommendationAllowed: boolean | null;
  keywordSearchAllowed: boolean | null;
  squareDistributionAllowed: boolean | null;
  buyAction: 'allow' | 'confirm' | 'block' | 'unavailable';
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string {
  return typeof value === 'string' && value.length <= 512 && !/[\p{Cc}\p{Cf}]/u.test(value) ? value : '';
}
function grade(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 5 ? value : 0;
}
function time(value: unknown): string | null {
  const raw = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return typeof raw === 'string' && /^\d{1,19}$/.test(raw) && BigInt(raw) > BigInt(0) && BigInt(raw) <= BigInt('9223372036854775807') ? raw : null;
}
function bool(value: unknown): boolean | null { return typeof value === 'boolean' ? value : null; }
function rows(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.map(record) : []; }
function field(raw: Record<string, unknown>, camel: string, snake: string) { return raw[camel] ?? raw[snake]; }

const TAX_CODES = new Set(['goplus_buy_tax', 'goplus_sell_tax', 'goplus_transfer_tax', 'goplus_transfer_fee']);

/** Exact decimal percent validation. Keep the original precision; never parse as float. */
function validRate(value: unknown): value is string {
  if (typeof value !== 'string' || !text(value) || !/^\d+(?:\.\d+)?$/.test(value)) return false;
  const [integer, fraction = ''] = value.split('.');
  const whole = integer.replace(/^0+/, '') || '0';
  return whole.length < 3 || whole === '100' && !/[1-9]/.test(fraction);
}

/** Only known, code-specific parameters are allowed into the display model. */
export function normalizeRiskParams(code: string, value: unknown): Record<string, string> {
  const raw = record(value);
  if (TAX_CODES.has(code) && validRate(raw.rate)) return {rate: raw.rate};
  if (code === 'goplus_honeypot_with_same_creator' && typeof raw.count === 'string' && text(raw.count) && /^\d+$/.test(raw.count)) {
    return {count: raw.count};
  }
  return {};
}

export function normalizeRiskAssessment(value: unknown): RiskAssessment {
  const raw = record(value);
  const items = new Map<string, RiskItem>();
  for (const item of rows(raw.items)) {
    const code = text(item.code);
    if (!code || items.has(code)) continue; // Count canonical backend items, not evidence or provider flags.
    items.set(code, {
      code, grade: grade(item.grade), displaySource: text(field(item, 'displaySource', 'display_source')),
      params: normalizeRiskParams(code, item.params),
      evidence: rows(item.evidence).map((e) => ({source: text(e.source), field: text(e.field), value: text(e.value), observedAtMs: time(field(e, 'observedAtMs', 'observed_at_ms'))})),
    });
  }
  const action = field(raw, 'buyAction', 'buy_action');
  return {
    mode: raw.mode === 'enforce' || raw.mode === 'observe' ? raw.mode : '',
    grade: grade(raw.grade), checksComplete: field(raw, 'checksComplete', 'checks_complete') === true,
    validUntilMs: time(field(raw, 'validUntilMs', 'valid_until_ms')),
    policyVersion: text(field(raw, 'policyVersion', 'policy_version')),
    decisionVersion: text(field(raw, 'decisionVersion', 'decision_version')),
    confirmationVersion: text(field(raw, 'confirmationVersion', 'confirmation_version')),
    items: [...items.values()],
    checks: rows(raw.checks).map((c) => ({code: text(c.code), state: text(c.state), value: text(c.value)})),
    goplusStatus: text(field(raw, 'goplusStatus', 'goplus_status')),
    goplusObservedAtMs: time(field(raw, 'goplusObservedAtMs', 'goplus_observed_at_ms')),
    lastAttemptAtMs: time(field(raw, 'lastAttemptAtMs', 'last_attempt_at_ms')),
    recommendationAllowed: bool(field(raw, 'recommendationAllowed', 'recommendation_allowed')),
    keywordSearchAllowed: bool(field(raw, 'keywordSearchAllowed', 'keyword_search_allowed')),
    squareDistributionAllowed: bool(field(raw, 'squareDistributionAllowed', 'square_distribution_allowed')),
    buyAction: action === 'allow' || action === 'confirm' || action === 'block' ? action : 'unavailable',
  };
}

/** Display freshness only. Never changes grade, items, mode or confirmation identity. */
export function riskChecksReusable(risk: RiskAssessment | undefined, now: number, refreshFailed = false): boolean {
  if (!risk?.checksComplete) return false;
  if (risk.validUntilMs == null) return !refreshFailed;
  const deadline = time(risk.validUntilMs);
  return deadline !== null && BigInt(deadline) > BigInt(Math.trunc(now));
}

/** Provider unknowns cannot block Buy. Sell never consumes the buy decision. */
export function riskTradeAction(risk: RiskAssessment | undefined, side: 'buy' | 'sell') {
  if (side === 'sell' || risk?.mode !== 'enforce') return 'allow';
  // The backend can retain a known grade while its decision store is unavailable.
  // Preserve that authoritative grade's restriction; never consult provider flags.
  if (risk.grade === 5) return 'block';
  if (risk.buyAction === 'block') return 'block';
  if (risk.grade === 4 && risk.buyAction === 'unavailable') return 'confirm';
  if (risk.buyAction === 'confirm') return 'confirm';
  return 'allow';
}

// Titles and explanations are application copy, never provider HTML/free text.
export const RISK_COPY: Record<string, readonly [string, string]> = {
  goplus_closed_source: ['Contract source unavailable', 'Verified contract source was unavailable to the risk check, so the contract could not be fully inspected. This does not establish that the source is closed.'],
  goplus_honeypot: ['Honeypot detected', 'The token may allow purchases while preventing sales.'],
  goplus_mintable: ['Additional tokens can be minted', 'An authority can increase supply and dilute existing holdings.'],
  goplus_transfer_pausable: ['Transfers can be paused', 'An authority can suspend token transfers.'],
  goplus_owner_change_balance: ['Owner can change balances', 'The owner can modify token balances.'],
  goplus_blacklisted: ['Blacklist control', 'An authority can restrict selected addresses from transacting.'],
  goplus_hidden_owner: ['Hidden owner', 'Ownership controls may remain hidden in the contract.'],
  goplus_can_take_back_ownership: ['Ownership can be reclaimed', 'A previous owner may regain contract control.'],
  goplus_cannot_buy: ['Buy restriction reported', 'The risk check reported a buy restriction on the tested route. Results may differ on other routes or under different conditions.'],
  goplus_cannot_sell: ['Sell restriction reported', 'The risk check reported a sell restriction on the tested route. Results may differ on other routes or under different conditions.'],
  goplus_whitelisted: ['Special address privileges', 'Selected addresses may have different trading privileges or exemptions. This does not by itself mean that only whitelisted addresses can trade.'],
  goplus_b20_whitelist: ['Whitelist-only trading', 'The reported B20 whitelist control can restrict trading to approved addresses.'],
  goplus_slippage_modifiable: ['Tax can be changed', 'An authority can change transaction taxes.'],
  goplus_proxy: ['Proxy contract detected', 'The token uses a proxy contract. Its implementation may be replaceable depending on the contract controls; a proxy alone does not establish that upgrades are enabled.'],
  goplus_external_call: ['External contract calls', 'Token behavior depends on external contracts.'],
  goplus_anti_whale: ['Transaction limits', 'The token has limits on holdings or transaction amounts.'],
  goplus_trading_cooldown: ['Trading cooldown', 'A waiting period may apply between trades.'],
  goplus_cannot_sell_all: ['Full sale restricted', 'You may be unable to sell your entire balance.'],
  goplus_selfdestruct: ['Contract shutdown feature', 'A contract shutdown feature was reported. Its effect depends on the network rules and execution conditions; contract destruction is not guaranteed.'],
  goplus_personal_slippage_modifiable: ['Address-specific tax', 'An authority can set different taxes for individual addresses.'],
  goplus_airdrop_scam: ['Airdrop scam flagged', 'The token has been flagged as an airdrop scam.'],
  goplus_fake_token: ['Fake token flagged', 'The token has been flagged as an imitation token.'],
  goplus_gas_abuse: ['Gas abuse flagged', 'Transactions may consume excessive gas.'],
  goplus_honeypot_with_same_creator: ['Creator linked to honeypots', 'The creator is associated with other honeypot tokens.'],
  goplus_non_transferable: ['Non-transferable token', 'The token cannot be freely transferred.'],
  goplus_freezable: ['Accounts can be frozen', 'An authority can freeze token accounts.'],
  goplus_balance_mutable_authority: ['Balances can be changed', 'An authority can modify account balances.'],
  goplus_default_account_state_upgradable: ['Default account state can change', 'An authority can change the default state of new accounts.'],
  goplus_default_account_state: ['Accounts frozen by default', 'New token accounts start in a frozen state.'],
  goplus_metadata_mutable: ['Metadata can be changed', 'An authority can change token metadata.'],
  goplus_metadata_modifiable: ['Metadata can be changed', 'An authority can change token metadata.'],
  goplus_closable: ['Token can be closed', 'An authority can close the token.'],
  goplus_transfer_fee_upgradable: ['Transfer fee can change', 'An authority can update transfer fees.'],
  goplus_transfer_hook: ['Transfer hook risk', 'Custom programs can affect transfers; the backend has identified a risk.'],
  goplus_malicious_authority: ['Malicious authority flagged', 'A controlling address has been flagged as malicious.'],
  goplus_buy_tax: ['Buy tax', 'A tax applies when buying this token.'],
  goplus_sell_tax: ['Sell tax', 'A tax applies when selling this token.'],
  goplus_transfer_tax: ['Transfer tax', 'A tax applies when transferring this token.'],
  goplus_transfer_fee: ['Transfer fee', 'A fee applies when transferring this token.'],
  codex_scam: ['Scam flagged', 'The token has been flagged as a scam.'],
  codex_minimum_liquidity: ['Low liquidity', 'Limited liquidity can cause large price impact and make exiting difficult.'],
  codex_liquidity_unknown: ['Liquidity could not be verified', 'The available liquidity could not be reliably established.'],
  codex_liquidity_rug_pull: ['Liquidity removal risk', 'Liquidity activity suggests a potential rug pull.'],
  codex_suspicious_wallet_activity: ['Suspicious wallet activity', 'Wallet activity associated with this token has been flagged.'],
  codex_abnormal_buyer_ratio: ['Unusual buyer ratio', 'The distribution of buyers shows unusual activity.'],
  codex_dev_concentration: ['Developer concentration', 'Developer-linked wallets hold a concentrated share of supply.'],
  codex_sniper_concentration: ['Sniper concentration', 'Sniper wallets hold a concentrated share of supply.'],
  codex_bundled_launch: ['Bundled launch', 'Linked transactions at launch suggest coordinated buying.'],
  codex_potential_unknown: ['Additional risk flagged', 'A risk was reported that is not yet covered by a specific explanation.'],
};
export function riskCopy(code: string) {
  return Object.hasOwn(RISK_COPY, code) ? RISK_COPY[code] : ['Additional risk flagged', 'The risk service reported an additional risk for this token.'] as const;
}
export function riskItemCopy(item: RiskItem): readonly [string, string] {
  if (item.code === 'goplus_transfer_hook') {
    if (item.grade === 5) return ['Malicious transfer hook', 'A transfer hook program was flagged as malicious. It can affect token transfers and may put funds at risk.'];
    if (item.grade === 4) return ['Transfer hook can be modified', 'An authority can modify the transfer hook program, changing the logic that runs during transfers.'];
    if (item.grade === 2) return ['Transfer hook program detected', 'A custom program runs during token transfers. Its presence alone does not establish that the program is malicious.'];
  }
  return riskCopy(item.code);
}
export function riskHeading(risk?: RiskAssessment): string {
  if (risk?.grade === 5) return riskTradeAction(risk, 'buy') === 'block' ? 'High risk · Buying unavailable' : 'High risk';
  if (risk?.grade === 4) return 'High risk';
  if (risk?.grade === 3) return 'Risk warning';
  if (risk?.grade === 2) return 'Token notice';
  return 'Risk data unavailable';
}
export function riskDisplayParams(item: RiskItem): {key: string; label: string; value: string}[] {
  // Validate again at the display boundary for callers constructing items directly.
  const params = normalizeRiskParams(item.code, item.params);
  if (params.rate !== undefined) return [{key: 'rate', label: 'Rate', value: `${params.rate}%`}];
  if (params.count !== undefined) return [{key: 'count', label: 'Related honeypots', value: params.count}];
  return [];
}
export function riskItemTitle(item: RiskItem) {
  const title = riskItemCopy(item)[0];
  const rate = normalizeRiskParams(item.code, item.params).rate;
  return rate !== undefined ? `${title} (${rate}%)` : title;
}
export function riskSource(source: string) {
  return source === 'goplus' ? 'GoPlus' : source === 'codex' ? 'Codex' : 'Risk service';
}
