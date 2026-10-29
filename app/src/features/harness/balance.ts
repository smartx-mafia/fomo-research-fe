// Solana 主网 USDC 余额。**只读，直接问 RPC，不经过 business。**
//
// # 为什么不问服务端
//
// business 的对外面上没有"查余额"这个端点（契约里那三个是 create/prepare/
// submit，外加 positions）。而这个 harness 要回答的问题恰恰是链上的那个：
// 一键下单花的是**链上真实的 USDC**，签名又没有确认界面（main.tsx 的
// showWalletUIs=false），所以"这笔到底扣没扣钱"在页面上本来一点痕迹都没有。
// 直接读链是唯一能自证的那条路。
//
// # 用的是 Privy 那同一个端点
//
// NEXT_PUBLIC_SOLANA_RPC_URL 已经是必填（(harness)/layout.tsx 缺了就不渲染），那个端点本来就
// 被浏览器直接打（Privy 的签名路径在用），所以这里既不需要新配一个值，
// 也不需要代理绕 CORS。

/** 主网 USDC 的 mint。现金资产固定在 Solana USDC（ADR-0008）。 */
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** USDC 的小数位。**只作为兜底**：真实值每次从 RPC 的回包里读。 */
const USDC_DECIMALS = 6;

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;

export type UsdcBalance = {
  /** 最小单位（BigInt，不做 Number —— 与 api.ts 里金额一律字符串同一个理由）。 */
  raw: bigint;
  /** 已按 decimals 展开的十进制串，供显示。 */
  ui: string;
  /** 这个 owner 名下装着 USDC 的 token account 数量。0 = 一个都没有。 */
  accounts: number;
};

/**
 * 把最小单位展开成十进制串。**全程 BigInt，不碰浮点。**
 *
 * 21 位十进制装不进 JS 的 number（api.ts 开头那条），USDC 虽然到不了那个
 * 量级，但换算规则在这里破一次例，下一个抄这段代码的人就会在别的 token 上
 * 破第二次。
 */
export function formatUnits(raw: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const int = raw / base;
  const frac = raw % base;
  if (frac === 0n) return int.toString();
  // 去掉尾零：12.340000 → 12.34。前导零必须留（0.000001 不是 0.1）。
  const f = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${int}.${f}`;
}

/**
 * 查一个地址名下的 USDC 余额。
 *
 * # 为什么是 getTokenAccountsByOwner 而不是 getTokenAccountBalance
 *
 * 后者要的是 token account 的地址，而我们手上只有钱包地址。自己推 ATA 要
 * 引入派生逻辑（还要分 Token 与 Token-2022 两个 program），而且**只覆盖
 * ATA** —— 用户名下如果还有一个非 ATA 的 USDC 账户，那份钱就被漏掉，显示
 * 成「比实际少」。按 owner+mint 过滤是 RPC 自己做的，一个都不会漏，所以
 * 这里把所有命中账户加起来。
 *
 * # commitment 用 confirmed
 *
 * 这个函数的主要调用时机是**刚广播完一笔交易之后**。finalized 要等更久，
 * 那段时间里页面上显示的会是「还没扣」，而那正是最容易被读成"交易没成功"
 * 的一刻。confirmed 通常一两秒就跟上。
 */
export async function fetchUsdcBalance(owner: string, signal?: AbortSignal): Promise<UsdcBalance> {
  return fetchTokenBalance(owner, USDC_MINT, signal);
}

/**
 * 任意 mint 的版本。转账那张卡要用它 —— 「全部」按钮得知道这个 mint
 * 现在有多少。
 *
 * `fetchUsdcBalance` 是它写死 mint 的薄封装，**不是另一份实现**：
 * 同一段解析逻辑抄两遍的话，将来只会有一处被修对，而另一处的错法是
 * 「金额差几个数量级」，看起来像业务 bug。
 */
export async function fetchTokenBalance(
  owner: string,
  mint: string,
  signal?: AbortSignal,
): Promise<UsdcBalance> {
  if (!RPC_URL) throw new Error('没有配 NEXT_PUBLIC_SOLANA_RPC_URL');
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    signal,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountsByOwner',
      params: [owner, {mint}, {encoding: 'jsonParsed', commitment: 'confirmed'}],
    }),
  });
  // HTTP 层的错误要单独说：429（限流）与 401（key 不对）都会走到这里，
  // 而它们的处置完全不同 —— 只说"查不到余额"两种都得猜。
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const body = (await res.json()) as {
    error?: {code: number; message: string};
    result?: {
      value?: {
        account?: {data?: {parsed?: {info?: {tokenAmount?: {amount: string; decimals: number}}}}};
      }[];
    };
  };
  // JSON-RPC 的错误在 200 里（跟 business 那个恒 200 信封是同一种形状）。
  if (body.error) throw new Error(`RPC ${body.error.code} ${body.error.message}`);

  const value = body.result?.value ?? [];
  let raw = 0n;
  let decimals = USDC_DECIMALS;
  for (const a of value) {
    const amt = a.account?.data?.parsed?.info?.tokenAmount;
    if (!amt) continue;
    raw += BigInt(amt.amount);
    // 以链上说的为准。写死 6 在 USDC 上永远对，但这段代码换个 mint 就错，
    // 而错法是"金额差三个数量级"，看起来像业务 bug。
    decimals = amt.decimals;
  }
  return {raw, ui: formatUnits(raw, decimals), accounts: value.length};
}
