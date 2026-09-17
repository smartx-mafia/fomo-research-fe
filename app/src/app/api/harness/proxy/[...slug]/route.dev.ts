/**
 * harness dev-only 后端代理（迁移自 web-embedded-harness 的 `vite.config.ts` server.proxy）。
 *
 * ============================================================================
 * 这个文件的扩展名是 `.dev.ts` 而不是 `.ts`，**这不是笔误，改掉它生产构建就会炸**。
 * 见 `next.config.ts` 里 `pageExtensions` 那一段的完整说明。
 * ============================================================================
 *
 * **为什么是 Route Handler 而不是 `rewrites()`。**
 *
 * 三条规则里的 fastswap 那条必须**删掉请求里的 `Origin` 头**，而 Next 的
 * `rewrites()` 只能改路径、不能动请求头（它没有 `configure`/`proxyReq` 这种钩子）。
 * 实测（2026-09-18）：
 *
 *     GET https://sm-test-api.smartx.io/v2/swaps/capabilities  无 Origin → 200
 *     GET https://sm-test-api.smartx.io/v2/swaps/capabilities  + Origin → 403 "origin not allowed"
 *
 * fastswap 的 `allowed_origins` 零值语义是「拒绝一切带 Origin 的请求」，而且回的是
 * **不套信封的裸 403** —— 页面上看起来像没登录，人会去查 token。浏览器对同源 POST
 * 也会带 Origin，所以不摘掉它就一定撞上。
 *
 * 服务端 `fetch` 天然不带 `Origin`，只要不手动转发它就已经是对的。
 *
 * **为什么另外两条也走这里。**
 *
 * 本来可以用 `rewrites()`，但那样代理就分裂成两套机制、且 `rewrites()` 没有任何
 * 日志。归因一个"打不通"的请求时，第一件想知道的事就是「它到底发去了哪个源、
 * 对端回了几」—— 见文件末尾的 `console.info`。
 */

type ProxyRule = {
  /** 命中这条规则的路径前缀（rewrite 之后的 slug 段） */
  readonly prefix: readonly string[];
  /** 目标源。环境变量优先，`||` 而非 `??`：空串与"没配"是同一件事 */
  readonly origin: () => string;
  /** 转发出去的路径（已去掉本地前缀） */
  readonly rewrite: (slug: string[]) => string;
  /** 是否剥离 `Origin` 请求头 */
  readonly stripOrigin: boolean;
  readonly name: string;
};

const RULES: readonly ProxyRule[] = [
  {
    // **测试环境 business。** 页面在顶栏切到「测试环境」后，每一发请求的路径前面
    // 多一段 `/test-env`（前缀由 harness 的 envs.ts 加）。这一条按该前缀转到另一个
    // business，并把前缀摘掉 —— business 那边的路由是 `/v1/...`，带着前缀过去一律
    // 404，而 404 在 harness 页面上表现成「请求没到 business 的信封层」，看起来像
    // 后端是旧构建。
    //
    // 为什么不让页面直接打绝对 URL：两档环境要同时换后端和 Privy app id，两个变量
    // 漏改一个不报错（症状是登录 400100）。两档同时在线、页面上选，就不会只切一半。
    name: "test-env business",
    prefix: ["test-env", "v1"],
    origin: () => process.env.TEST_BUSINESS_ORIGIN || "https://sm-test-api.smartx.io",
    rewrite: (slug) => "/" + slug.slice(1).join("/"),
    stripOrigin: false,
  },
  {
    // **Fast Swap v2。** 它不在 business 上，是独立进程 sx_fastswap
    //（后端仓 configs/local/fastswap.yaml 的 fastswap.public.addr）。
    // `stripOrigin` 的理由见文件头。
    name: "fastswap",
    prefix: ["v2", "swaps"],
    origin: () => process.env.FASTSWAP_ORIGIN || "http://127.0.0.1:8082",
    rewrite: (slug) => "/" + slug.join("/"),
    stripOrigin: true,
  },
  {
    // **本机 business。** 端口取自后端仓 configs/business.yaml 的 server.http.addr。
    name: "business",
    prefix: ["v1"],
    origin: () => process.env.BUSINESS_ORIGIN || "http://127.0.0.1:8080",
    rewrite: (slug) => "/" + slug.join("/"),
    stripOrigin: false,
  },
];

/**
 * 逐跳头（hop-by-hop）不转发。
 *
 * **`host` 必须删掉 —— 这等价于 http-proxy 的 `changeOrigin: true`，而它曾经是 false，
 * 那让所有 https 目标整个不通。**
 *
 * http-proxy 把 TLS 的 SNI 跟着 `Host` 头走，于是保留 `Host: localhost:3000` 去打一个
 * https 目标 = 用 `servername: 'localhost'` 握手。对端（Cloudflare 之类）拿不到正确的
 * SNI 只能回一张兜底证书，链验不过，代理当场抛 `unable to verify the first certificate`，
 * 而页面上收到的是一个**正文为空的 HTTP 500**。
 *
 * 2026-09-03 在原仓实测钉死过因果，三发对照（目标同一个域名）：
 *     SNI = 默认（跟目标走） → 200
 *     SNI = 空               → 200
 *     SNI = 'localhost'      → unable to verify the first certificate
 * **所以这跟证书、跟系统 CA 都没有关系** —— 照那个误诊去装根证书、加 NODE_EXTRA_CA_CERTS
 * 的人会折腾很久然后发现毫无变化。
 *
 * 这里删掉 `host` 之后由 undici 按目标 URL 重新填，Host 与 SNI 都是目标的，正确。
 */
const DROPPED_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "content-length",
  // 让 undici 自己协商压缩并解码，否则下面回给浏览器的 body 已解压、
  // 而 content-encoding 头还写着 gzip，浏览器会解码失败。
  "accept-encoding",
]);

const DROPPED_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

function resolve(slug: string[]): { rule: ProxyRule; target: string } | null {
  for (const rule of RULES) {
    if (rule.prefix.every((seg, i) => slug[i] === seg)) {
      return { rule, target: rule.origin() + rule.rewrite(slug) };
    }
  }
  return null;
}

async function proxy(
  request: Request,
  ctx: { params: Promise<{ slug: string[] }> },
): Promise<Response> {
  const { slug } = await ctx.params;
  const hit = resolve(slug ?? []);

  if (!hit) {
    // 走到这里意味着 next.config.ts 的 rewrite 与这里的 RULES 对不上了 ——
    // 明确喊出来，不要静默 404 成一个看起来像"后端路由没有"的东西。
    const message = `[harness-proxy] no rule for /${(slug ?? []).join("/")}`;
    console.error(message);
    return new Response(message, { status: 502 });
  }

  const { rule, target } = hit;
  const search = new URL(request.url).search;
  const url = target + search;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (DROPPED_REQUEST_HEADERS.has(lower)) return;
    if (rule.stripOrigin && lower === "origin") return;
    headers.set(key, value);
  });

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;

  const startedAt = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
    });
  } catch (error) {
    // 连不上目标端口是本机后端没起来时的常态，把目标 URL 写出来，
    // 免得在浏览器里只看到一个没有来由的 502。
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const cause =
      error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
    console.error(`[harness-proxy] ${request.method} ${url} → FAILED ${reason}${cause}`);
    return new Response(`[harness-proxy] ${rule.name} unreachable: ${url}\n${reason}${cause}`, {
      status: 502,
    });
  }

  // 代理层至少记录目标 URL 与响应状态码，便于归因。
  console.info(
    `[harness-proxy] ${request.method} ${url} → ${upstream.status} ${Date.now() - startedAt}ms` +
      (rule.stripOrigin ? " [origin stripped]" : ""),
  );

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (DROPPED_RESPONSE_HEADERS.has(key.toLowerCase())) return;
    responseHeaders.set(key, value);
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;

// **不要在这里加 `export const dynamic`。** Route Handler 默认就不缓存
//（node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md §Caching），
// 而 `"force-dynamic"` 与 `next build` 的 `output: "export"` 互斥，写上会把一个
// dev-only 文件变成生产构建的阻塞项。
