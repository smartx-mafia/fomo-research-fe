import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {serializedChainSymbol, validSerializedAddress} from '@/lib/serialized-audit';

const ENDPOINT = 'https://www.serializedaudit.io/api/audit-contract';
const TIMEOUT_MS = 35_000;

async function apiKey(): Promise<string> {
  const configured = process.env.SERIALIZED_AUDIT_API_KEY?.trim();
  if (configured) return configured;
  try {
    return (await readFile(path.join(process.cwd(), 'serializedAudit.md'), 'utf8')).trim();
  } catch {
    return '';
  }
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {status, headers: {'cache-control': 'no-store'}});
}

export async function GET(request: Request): Promise<Response> {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return json({error: 'Cross-site audit requests are not allowed.'}, 403);

  const input = new URL(request.url);
  const chain = input.searchParams.get('chain')?.trim().toLowerCase() ?? '';
  const address = input.searchParams.get('address')?.trim() ?? '';
  const symbol = serializedChainSymbol(chain);
  if (!symbol || !validSerializedAddress(chain, address)) return json({error: 'Unsupported chain or invalid contract address.'}, 400);

  const key = await apiKey();
  if (!key) return json({error: 'Serialized Audit API key is not configured.'}, 503);

  const upstreamURL = new URL(ENDPOINT);
  upstreamURL.searchParams.set('chain', symbol);
  upstreamURL.searchParams.set('address', address);
  // 原型与 Serialized Audit 官网行为保持一致：闭源合约允许反编译后审计。
  upstreamURL.searchParams.set('allow_decompile', 'true');

  let upstream: Response;
  try {
    upstream = await fetch(upstreamURL, {
      headers: {accept: 'application/json', 'X-Auth-Key': key},
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)]),
      cache: 'no-store',
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    return json({error: timedOut ? 'Serialized Audit timed out.' : 'Serialized Audit is unavailable.'}, 502);
  }

  const body: unknown = await upstream.json().catch(() => null);
  if (body === null) return json({error: 'Serialized Audit returned a non-JSON response.'}, 502);
  return json(body, upstream.status);
}
