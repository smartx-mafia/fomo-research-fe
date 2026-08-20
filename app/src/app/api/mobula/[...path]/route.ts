import { NextRequest, NextResponse } from "next/server";
import { mobulaFetch, isAllowedPath } from "@/lib/mobula";

/**
 * 通用 BFF 转发：/api/mobula/<path> → https://{MOBULA_API_HOST}/api/2/<path>
 * 浏览器只跟这个同源接口打交道，不直连 api.mobula.io（避免跨域，且 API key 不出服务端）。
 */

const CACHE_BY_PREFIX: [string, number][] = [
  ["token/ohlcv-history", 15],
  ["token/holder-positions", 10],
  ["token/details", 8],
  ["token/trades", 4],
  ["pulse", 4],
];

function revalidateFor(path: string): number {
  return CACHE_BY_PREFIX.find(([prefix]) => path.startsWith(prefix))?.[1] ?? 5;
}

async function handle(req: NextRequest, path: string) {
  if (!isAllowedPath(path)) {
    return NextResponse.json({ error: "Path not allowed" }, { status: 403 });
  }

  const query: Record<string, string[]> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    (query[key] ??= []).push(value);
  });
  const flatQuery: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(query)) flatQuery[k] = v.length === 1 ? v[0] : v;

  const method = req.method === "POST" ? "POST" : "GET";
  const body = method === "POST" ? await req.json().catch(() => undefined) : undefined;

  try {
    const data = await mobulaFetch(path, flatQuery, { method, body, revalidate: revalidateFor(path) });
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream error";
    const status = /HTTP 429/.test(message) ? 429 : /HTTP 4\d\d/.test(message) ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return handle(req, path.join("/"));
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return handle(req, path.join("/"));
}
