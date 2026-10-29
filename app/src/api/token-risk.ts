import { call, ApiError } from "./envelope";
import { MARKET_API_BASE } from "@/lib/market";
import { ORDER_CHAINS } from "@/lib/limit-order-input";
import type { OrderInput } from "./limit-orders";

export type RiskScope = { chain: string; address: string; flow_id: string };
export type RiskAssessment = {
  mode: string;
  grade: number;
  buy_action: string;
  confirmation_version: string;
  valid_until_ms?: number | string;
  items?: { code: string; title?: string; detail?: string }[];
};
export function riskScope(error: ApiError, input: OrderInput): RiskScope {
  const m = error.metadata;
  const expected = ORDER_CHAINS.find(
    (c) => c.caip === input.intent.destination_chain,
  );
  if (
    input.scenario > 2 ||
    !expected ||
    typeof m?.chain !== "string" ||
    m.chain !== expected.slug ||
    typeof m.address !== "string" ||
    typeof m.flow_id !== "string" ||
    !m.flow_id.startsWith("fastswap:") ||
    m.flow_id.length > 191
  )
    throw new Error("Risk confirmation scope does not match this order.");
  const same =
    expected.slug === "solana"
      ? m.address === input.intent.destination_asset
      : m.address.toLowerCase() ===
        input.intent.destination_asset.toLowerCase();
  if (!same) throw new Error("Risk token does not match this order.");
  return { chain: m.chain, address: m.address, flow_id: m.flow_id };
}
function path(scope: RiskScope) {
  return `${MARKET_API_BASE}/v1/tokens/${encodeURIComponent(scope.chain)}/${encodeURIComponent(scope.address)}/risk`;
}
export async function getOrderRisk(
  bearer: string,
  scope: RiskScope,
): Promise<RiskAssessment> {
  const { data } = await call<{
    chain: string;
    address: string;
    risk: { assessment?: RiskAssessment };
  }>(path(scope), { bearer });
  if (
    data.chain !== scope.chain ||
    data.address !== scope.address ||
    !data.risk?.assessment
  )
    throw new Error("Risk evidence is unavailable.");
  return data.risk.assessment;
}
export function canConfirmRisk(a: RiskAssessment, now = Date.now()) {
  return (
    a.mode === "enforce" &&
    a.grade === 4 &&
    a.buy_action === "confirm" &&
    !!a.confirmation_version &&
    (a.valid_until_ms === undefined || Number(a.valid_until_ms) > now)
  );
}
export async function confirmOrderRisk(
  bearer: string,
  scope: RiskScope,
  a: RiskAssessment,
) {
  if (!canConfirmRisk(a))
    throw new Error(
      "Risk evidence is blocked, expired or unavailable. Refresh it before confirming.",
    );
  await call(`${path(scope)}/confirm`, {
    bearer,
    method: "POST",
    body: {
      flow_id: scope.flow_id,
      confirmation_version: a.confirmation_version,
    },
  });
}

import {normalizeTokenRef, tokenKey} from './token-metadata';
import {normalizeTokenRisk, type TokenRisk} from '@/lib/token-risk';

export type GetRiskReply = {chain: string; address: string; risk: TokenRisk};
export const requiresRiskConfirmation = (error: unknown) => error instanceof ApiError && error.kind === 'business' && (error.code === 430310 || error.code === 430312);
export const isRiskRejection = (error: unknown) => requiresRiskConfirmation(error) || error instanceof ApiError && error.kind === 'business' && (error.code === 430311 || error.code === 500310);

function normalizeReply(value: unknown, chain: string, address: string): GetRiskReply {
  const raw = value as Partial<GetRiskReply> | null;
  const expected = tokenKey(chain, address);
  if (!expected || !raw || typeof raw.chain !== 'string' || typeof raw.address !== 'string' || tokenKey(raw.chain, raw.address) !== expected || !raw.risk || typeof raw.risk !== 'object' || Array.isArray(raw.risk)) {
    throw new Error('Risk response does not match the requested token.');
  }
  return {chain: raw.chain, address: raw.address, risk: normalizeTokenRisk(raw.risk)};
}
function riskPath(chain: string, address: string) {
  const ref = normalizeTokenRef(chain, address);
  if (!ref) throw new Error('Invalid token reference.');
  return `/v1/tokens/${encodeURIComponent(ref.chain)}/${encodeURIComponent(ref.address)}/risk`;
}
export async function getTokenRisk(chain: string, address: string, bearer?: string, signal?: AbortSignal): Promise<GetRiskReply> {
  const reply = await call<unknown>(riskPath(chain, address), {
    bearer,
    signal,
    preserveInt64Fields: ['observed_at_ms', 'fetched_at_ms', 'valid_until_ms', 'last_attempt_at_ms'],
  });
  return normalizeReply(reply.data, chain, address);
}
export async function confirmTokenRisk(chain: string, address: string, bearer: string, flowID: string, confirmationVersion: string, signal?: AbortSignal): Promise<GetRiskReply> {
  if (!bearer || !flowID || !confirmationVersion) throw new Error('Sign in and review the current risks before confirming.');
  const reply = await call<unknown>(`${riskPath(chain, address)}/confirm`, {
    method: 'POST', bearer, signal, body: {flow_id: flowID, confirmation_version: confirmationVersion},
  });
  return normalizeReply(reply.data, chain, address);
}
