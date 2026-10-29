/**
 * Node 侧调 Privy 的服务端签名接口，替已授权的 embedded 钱包签名。
 *
 * ⚠ **这个模块只在 Node 里用，浏览器一个字节都不该碰到它。** 它 import 了
 * `node:crypto`，也读 app secret 与授权私钥 —— 那两样进了 bundle 就等于把
 * 所有已授权钱包的代签权发给了每一个访客。真被谁从 `App.tsx` 引进去，
 * vite 会在解析 `node:crypto` 时当场失败，那是刻意留着的响亮失败。
 *
 * # 形状不是猜的
 *
 * 授权签名那套算法抄自后端仓 `app/trade/internal/meme/sponsor/
 * privy_live_trade_test.go` 的 `privyLiveAuthSignature`（那是实跑过的）；
 * 两个 RPC 的请求与回包字段抄自 Privy 官方 Go SDK v0.15.0 的
 * `wallet.go`（`EthereumSecp256k1SignRpcInput` / `SolanaSignTransactionRpcResponse`）。
 * 这一层的线格式只能量，不能推 —— `api.ts` 里 `status` 那段记的就是推错一次
 * 的代价。
 *
 * # 为什么服务端签得动
 *
 * 前提是这只钱包已经在浏览器里挂过 signer（见 `signers.ts`）。没挂的话
 * Privy 回 401，而那个 401 曾被记成「架构上不可能」—— 它只是「没授权」。
 *
 * # 迁到 Next 之后，护栏换了一种（2026-09-18）
 *
 * 上面那句「vite 会在解析 `node:crypto` 时当场失败」说的是源仓库的情况。搬进
 * 宿主之后**那道护栏不再可靠**，而这个模块能泄露的东西一点没变：
 *
 *   - 宿主是 `output: "export"` 的**纯静态站点**，没有任何服务端运行时可以承载
 *     它 —— 也就是说，这里不存在「放进服务端代码就安全了」这个选项。唯一安全的
 *     执行位置是**开发者本机的 Node 进程**。
 *   - 一旦有人从 `src/` 里 import 它，Next 会把它编进**客户端 bundle**，等于把
 *     所有已授权钱包的代签权发给每一个访客。
 *
 * 所以护栏改成**物理隔离**：这个文件不在 `src/` 下，而在 `scripts/harness/`。
 * Next 的模块图以 `src/app/**` 为根，够不到 `scripts/`；`tsconfig.json` 的
 * `paths` 里那个 `@/*` 也只映射 `./src/*`，从应用代码里根本写不出指向这里的
 * 别名路径。要引它只能写一条爬出 `src/` 的相对路径（`../../../scripts/...`），
 * 那是一个 code review 里一眼能看见的动作，而不是一个顺手的 import。
 *
 * **移动这个文件之前先想清楚它会被编进谁的 bundle。** 把它挪回 `src/` 下的任何
 * 位置都会重新打开上面那条路径。
 */

import {createSign} from 'node:crypto';

/** Privy API 根地址。staging 走 `https://api.staging.privy.io`。 */
const DEFAULT_API_BASE = 'https://api.privy.io';

/**
 * JCS（RFC 8785）规范化。**键按字典序递归排序，数组保持原序。**
 *
 * 必须与 Go 那侧逐字节一致，否则签名对不上，而 Privy 只回一句「签名无效」，
 * 指不回"你的 JSON 键序不同"。两个要点：
 *
 *   - Go 的 `encoding/json` 编 map 时**自动按键排序**，而 JS 的
 *     `JSON.stringify` 保持插入顺序 —— 所以这里必须自己排。
 *   - Go 那侧刻意 `SetEscapeHTML(false)`：默认会把 `<` `>` `&` 转成 `<`
 *     这类，而 JCS 不转。JS 默认就不转，这一条天然对齐。
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const parts = Object.keys(obj)
    .sort()
    // undefined 的键在 JSON 里根本不存在，跟着排序留下来会多编出一个 null。
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
  return `{${parts.join(',')}}`;
}

/**
 * 要被签的那份 payload。**字段一个都不能多、不能少。**
 *
 * `headers` 里只放 `privy-app-id` 一项 —— Privy 的规范就是这么定的，
 * 把实际发出去的其他头也塞进来会让签名对不上。
 */
export function authPayload(url: string, body: unknown, appId: string): Record<string, unknown> {
  return {version: 1, method: 'POST', url, body, headers: {'privy-app-id': appId}};
}

/**
 * 算 `privy-authorization-signature`：JCS → SHA-256 → ECDSA P-256 → DER → base64。
 *
 * `authzKeyPem` 是那把 P-256 私钥的 PEM 全文（`openssl ecparam -name prime256v1
 * -genkey -noout` 生成的那把）。**它等同于对所有已授权钱包的代签权**，
 * 只从环境变量或本机文件来，绝不进版本库。
 */
export function authorizationSignature(canonical: string, authzKeyPem: string): string {
  // `createSign('SHA256')` 自己做那一次哈希再签，等价于 Go 那侧的
  // `sha256.Sum256` + `ecdsa.SignASN1(sum)`。**别在这里先自己哈希一遍**，
  // 那会变成对哈希再哈希，签出来的东西 Privy 一律判无效。
  const signer = createSign('SHA256');
  signer.update(canonical);
  signer.end();
  return signer.sign(authzKeyPem, 'base64');
}

export type PrivySignerConfig = {
  appId: string;
  appSecret: string;
  /** P-256 私钥 PEM 全文。 */
  authzKeyPem: string;
  apiBase?: string;
};

/**
 * 从环境变量读配置。**缺哪个说哪个** —— 只说"配置不全"的话，人得回来读源码。
 *
 * 三个变量都**没有 VITE_ 前缀**，这是刻意的：带前缀的会进 bundle。
 * 迁到 Next 之后同一条规矩对应的是**没有 `NEXT_PUBLIC_` 前缀** —— Next 只把带
 * 那个前缀的变量内联进客户端代码，不带的只在 Node 进程里存在。这三个（连同
 * 脚本用的 `PRIVY_AUTHZ_KEY` / `PRIVY_EVM_*` / `PRIVY_SOL_*`）一个都不许加前缀。
 */
export function configFromEnv(env: Record<string, string | undefined>): PrivySignerConfig {
  const missing: string[] = [];
  const appId = env.PRIVY_APP_ID ?? '';
  const appSecret = env.PRIVY_APP_SECRET ?? '';
  const authzKeyPem = env.PRIVY_AUTHZ_KEY_PEM ?? '';
  if (!appId) missing.push('PRIVY_APP_ID          Privy 应用 id，与页面当前环境那个一致');
  if (!appSecret) missing.push('PRIVY_APP_SECRET      Privy 控制台的 app secret');
  if (!authzKeyPem) {
    missing.push('PRIVY_AUTHZ_KEY_PEM   P-256 授权私钥的 PEM 全文（脚本会从 PRIVY_AUTHZ_KEY 指的文件读）');
  }
  if (missing.length > 0) {
    throw new Error(`缺环境变量：\n  ${missing.join('\n  ')}`);
  }
  return {appId, appSecret, authzKeyPem, apiBase: env.PRIVY_API_BASE};
}

/** 一次 RPC 的耗时，报给外面记账用。与业务耗时分开（它是外部依赖）。 */
export type PrivyTiming = {
  method: string;
  walletId: string;
  startedAt: number;
  completedAt: number;
  status?: number;
  ok: boolean;
};

export type PrivySigner = {
  /**
   * 对**裸 32 字节摘要**签（`secp256k1_sign`）。
   *
   * 注意不是带 EIP-191 前缀的消息签名 —— 加了前缀链上会回 AA24，而那个码
   * 指向签名校验，看起来像钥匙不对。摘要要 `0x` 开头。
   *
   * 交回 `0x` 开头的 65 字节签名。
   */
  signEvmDigest(walletId: string, digestHex: string): Promise<string>;
  /**
   * 签整只 Solana 交易（`signTransaction`）。
   *
   * 交回的是**签好的整笔交易**（base64），不是那 64 字节签名 —— 要交给
   * business 的只有自己那一槽，取法见 `signature.ts` 的 `extractSignature`
   * （按地址找槽位，不按位置）。
   */
  signSolanaTransaction(walletId: string, txBase64: string): Promise<string>;
};

export type PrivySignerOptions = {
  /** 每次 RPC 结束后回调，成败都报。抛错会被吞掉，观测不影响被观测者。 */
  onTiming?: (t: PrivyTiming) => void;
  /** 注入给测试用。默认走全局 `fetch`。 */
  fetchImpl?: typeof fetch;
};

export function createPrivySigner(
  cfg: PrivySignerConfig,
  opts: PrivySignerOptions = {},
): PrivySigner {
  const base = (cfg.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, '');
  const doFetch = opts.fetchImpl ?? fetch;

  async function rpc(walletId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = `${base}/v1/wallets/${walletId}/rpc`;
    const canonical = canonicalize(authPayload(url, body, cfg.appId));
    const sig = authorizationSignature(canonical, cfg.authzKeyPem);

    // **发出去的正文必须与被签的那份逐字节相同。** 各编一次的话，键序或空格
    // 差一点签名就对不上，而 Privy 只回「签名无效」——指不回这里。
    const raw = canonicalize(body);

    const startedAt = performance.now();
    let status: number | undefined;
    let ok = false;
    try {
      const resp = await doFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${cfg.appId}:${cfg.appSecret}`).toString('base64')}`,
          'privy-app-id': cfg.appId,
          'privy-authorization-signature': sig,
        },
        body: raw,
      });
      status = resp.status;
      const text = await resp.text();
      if (resp.status !== 200) {
        // 401/403 几乎总是同一件事，而它的处置完全不同于别的失败：
        // 不是重试，是去浏览器里补一次授权。
        const hint =
          resp.status === 401 || resp.status === 403
            ? '\n  这只钱包多半没挂 signer —— 去页面的「服务端代签授权」点一次授权，' +
              '或确认 key quorum 与这个 app 对得上。这不是架构不支持。'
            : '';
        throw new Error(`Privy 签名 HTTP ${resp.status}：${text.slice(0, 400)}${hint}`);
      }
      const parsed = JSON.parse(text) as {data?: Record<string, unknown>};
      if (!parsed.data) throw new Error(`Privy 回包里没有 data：${text.slice(0, 400)}`);
      ok = true;
      return parsed.data;
    } finally {
      if (opts.onTiming) {
        try {
          opts.onTiming({
            method: String(body.method),
            walletId,
            startedAt,
            completedAt: performance.now(),
            status,
            ok,
          });
        } catch {
          /* 观测不该影响被观测者 */
        }
      }
    }
  }

  return {
    async signEvmDigest(walletId, digestHex) {
      if (!/^0x[0-9a-fA-F]+$/.test(digestHex)) {
        // 少个 0x 时 Privy 会拒，但报的是参数格式，看起来像摘要算错了。
        throw new Error(`摘要必须是 0x 开头的十六进制串，收到「${digestHex}」`);
      }
      const data = await rpc(walletId, {
        method: 'secp256k1_sign',
        params: {hash: digestHex},
      });
      const sig = data.signature;
      if (typeof sig !== 'string') throw new Error(`回包里没有 signature：${JSON.stringify(data)}`);
      return sig;
    },

    async signSolanaTransaction(walletId, txBase64) {
      const data = await rpc(walletId, {
        method: 'signTransaction',
        params: {transaction: txBase64, encoding: 'base64'},
      });
      const signed = data.signed_transaction;
      if (typeof signed !== 'string') {
        throw new Error(`回包里没有 signed_transaction：${JSON.stringify(data)}`);
      }
      return signed;
    },
  };
}
