/**
 * 后端自检 —— **不碰 Privy、不需要登录**。
 *
 * 它把"后端够不够得着"从"登录能不能成"里切出来。没有这一层的话，代理没起、
 * 后端是旧构建、identity token 过期这三件事，症状都是「登录失败」，
 * 而排查方向完全不同。
 *
 * 抄自 `../privy-login-demo/src/components/SelfCheckCard.tsx`，但**判读逻辑
 * 从组件里搬了出来**：这两个探针的全部价值就在"什么算通过"这几行上
 * （尤其是"探针 1 期望的是失败"这一条反直觉的判据），埋在 JSX 里没法用
 * 用例钉住。
 *
 * # 两个探针各自证明什么
 *
 *   探针 1：不带任何凭据打 `GET /v1/user/info`，**期望 400000**。
 *           拿到它就同时证明了三件事：代理通了、信封层活着、这个后端认得
 *           这条路由。**成功反而是异常** —— 该端点是 Required 档。
 *   探针 2：用一个必然无效的 identity_token 打 `POST /v1/auth/login`，
 *           期望 100108 / 400100。**拿到 HTTP 404 就说明这个后端是旧构建**，
 *           根本没有这条路由 —— 这是区分新旧构建唯一的廉价办法。
 */
import {ApiError, probeLoginRoute, probeUnauthenticated} from './api';

export type Probe = {
  ok: boolean;
  /** 一句结论。 */
  text: string;
  /** 补充线索：trace_id、原始响应体、或者"下一步该改哪个配置"。 */
  detail?: string;
};

export type SelfCheckResult = {
  envelope: Probe;
  route: Probe;
};

/**
 * **HTTP 500 且响应体是空的 = dev server 的代理自己失败了，请求根本没出这台机器。**
 *
 * 这一格值得单独存在，因为它与"后端回了 500"长得一模一样而成因完全不同：
 *
 *   - business 的对外面**恒 200**（红线 9）。它真出问题时回的是 `200 + 六位码`
 *     的信封，不是 HTTP 500。所以 HTTP 500 一定不是 business 说的话。
 *   - vite 的代理转发失败时（目标连不上、DNS 解析不了、**TLS 握手失败**）
 *     回的就是一个 `text/plain` 的空 500，**正文一个字都没有** ——
 *     真正的原因只印在**起 dev server 的那个终端**里。
 *
 * 2026-09-03 实测撞到的那次：`BUSINESS_ORIGIN` 指了一个 https 域名，而
 * `vite.config.ts` 里 `changeOrigin` 是 `false` —— http-proxy 让 TLS 的 SNI
 * 跟着 Host 走，于是它拿 `servername: 'localhost'` 去握手，对端回一张兜底
 * 证书，链验不过。成因与修法记在 `vite.config.ts` 的 changeOrigin 那段。
 *
 * **那次的误诊值得留着**：同一台机器上 `curl` 打那个域名是 200，于是第一版
 * 判读写成了"Node 默认不用系统 CA" —— 而 curl 之所以成，只是因为它按目标名
 * 发 SNI，不是因为它的 CA 库更全。照那个说法去装根证书、去加
 * `NODE_EXTRA_CA_CERTS` 的人会折腾很久然后发现毫无变化。
 *
 * 所以这里**不猜具体成因**，只把人指到唯一有真话的地方：dev server 的终端。
 * 不单列的话，页面给的是"检查代理、进程与这个后端有没有这条路由"三个猜测，
 * 而正确答案一个都不在里面。
 */
function proxyItselfFailed(err: ApiError): boolean {
  return err.kind === 'transport' && err.code >= 500 && !err.rawBody?.trim();
}

const PROXY_FAILED: Probe = {
  ok: false,
  text: 'HTTP 500 且响应体是空的 —— 这不是后端说的话，是 dev server 的代理自己没转发出去',
  detail:
    'business 的对外面恒 200（真出错回的是 200+六位码的信封），所以 HTTP 500 只可能来自代理。' +
    '**真正的原因只印在起 dev server 的那个终端里**，去看那一行 `[vite] http proxy error`：' +
    '常见的是目标连不上、DNS 解析不了、或 TLS 握手失败。' +
    '别被"同一台机器上 curl 打得通"带偏 —— curl 与代理发出去的 SNI / Host 不一定是同一个。',
};

/**
 * 判读探针 1。
 *
 * `caught` 为 null 表示请求**成功**了 —— 而这里成功才是异常，
 * 所以它不是"没有错误"，是一条要报出去的结论。
 */
export function readEnvelopeProbe(caught: unknown): Probe {
  if (caught === null) {
    return {
      ok: false,
      text: '异常：匿名请求竟然成功了，这不符合契约（该端点是 Required 档）',
    };
  }
  if (!(caught instanceof ApiError)) {
    return {ok: false, text: `未通过：${caught instanceof Error ? caught.message : String(caught)}`};
  }
  if (caught.kind === 'business' && caught.code === 400000) {
    return {
      ok: true,
      text: '通过：拿到 400000 / SYS_UNAUTHENTICATED',
      detail: `代理通、信封层活着、路由存在。trace_id=${caught.traceID ?? '-'}`,
    };
  }
  if (proxyItselfFailed(caught)) return PROXY_FAILED;
  return {
    ok: false,
    text: `未通过：${caught.kind} / ${caught.code} — ${caught.message}`,
    detail:
      caught.kind === 'network'
        ? 'dev server 没起，或代理目标不通。检查 .env.local 的 BUSINESS_ORIGIN（没有 VITE_ 前缀）并重启 dev server。'
        : caught.rawBody,
  };
}

/** 判读探针 2。`caught` 为 null 同上：假 token 登录成功是异常。 */
export function readRouteProbe(caught: unknown): Probe {
  if (caught === null) {
    return {ok: false, text: '异常：假 identity token 竟然登录成功了'};
  }
  if (!(caught instanceof ApiError)) {
    return {ok: false, text: `未通过：${caught instanceof Error ? caught.message : String(caught)}`};
  }
  if (caught.kind === 'business' && (caught.code === 400100 || caught.code === 100108)) {
    return {
      ok: true,
      text: `通过：拿到 ${caught.code}，路由存在且 Privy 验签在跑`,
      detail: `trace_id=${caught.traceID ?? '-'}`,
    };
  }
  if (caught.kind === 'transport' && caught.code === 404) {
    return {
      ok: false,
      text: 'HTTP 404 —— 这个后端是旧构建，没有 /v1/auth/login 路由',
      detail:
        '换一个带登录的 business：改 .env.local 的 BUSINESS_ORIGIN，改完**必须重启 dev server**（代理配置在启动时读一次）。',
    };
  }
  if (caught.kind === 'business' && caught.code === 500097) {
    return {
      ok: false,
      text: '500097 —— 这台 business 没配 privy.app_id / privy.verification_key（或数据库连不上），登录不可用',
      detail:
        '身份的唯一来源就是这条链路，**没有本机逃生舱**（/dev/token 已于 2026-09-02 删除）。先把 configs/business.secret.yaml 配好。',
    };
  }
  if (proxyItselfFailed(caught)) return PROXY_FAILED;
  return {ok: false, text: `未通过：${caught.kind} / ${caught.code} — ${caught.message}`};
}

/** 把一个"期望失败"的调用变成"它抛了什么"。成功时交回 null。 */
async function catching(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (e) {
    return e;
  }
}

/**
 * 跑两个探针。**两个都跑完再回**，不在第一个失败时短路 ——
 * 第二个探针回的是什么，恰恰是判断第一个为什么失败的最好参照
 * （同一台机器上一条回正常信封、另一条回裸 404 = 旧构建，而不是代理问题）。
 */
export async function runSelfCheck(): Promise<SelfCheckResult> {
  return {
    envelope: readEnvelopeProbe(await catching(probeUnauthenticated)),
    route: readRouteProbe(await catching(probeLoginRoute)),
  };
}
