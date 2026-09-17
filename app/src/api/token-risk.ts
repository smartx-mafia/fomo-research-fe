import {call, ApiError} from './envelope';
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
  const reply = await call<unknown>(riskPath(chain, address), {bearer, signal});
  return normalizeReply(reply.data, chain, address);
}
export async function confirmTokenRisk(chain: string, address: string, bearer: string, flowID: string, confirmationVersion: string, signal?: AbortSignal): Promise<GetRiskReply> {
  if (!bearer || !flowID || !confirmationVersion) throw new Error('Sign in and review the current risks before confirming.');
  const reply = await call<unknown>(`${riskPath(chain, address)}/confirm`, {
    method: 'POST', bearer, signal, body: {flow_id: flowID, confirmation_version: confirmationVersion},
  });
  return normalizeReply(reply.data, chain, address);
}
