import {normalizeSerializedAudit, serializedChainSymbol, validSerializedAddress, type SerializedAuditResult} from '@/lib/serialized-audit';

export async function getSerializedAudit(chain: string, address: string, signal?: AbortSignal): Promise<SerializedAuditResult> {
  if (!serializedChainSymbol(chain) || !validSerializedAddress(chain, address)) throw new Error('Serialized Audit does not support this token reference.');
  const params = new URLSearchParams({chain: chain.trim().toLowerCase(), address: address.trim()});
  const response = await fetch(`/api/serialized-audit?${params}`, {signal, headers: {accept: 'application/json'}});
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const raw = body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    throw new Error(typeof raw.error === 'string' && raw.error ? raw.error : `Serialized Audit request failed (${response.status}).`);
  }
  return normalizeSerializedAudit(body);
}
