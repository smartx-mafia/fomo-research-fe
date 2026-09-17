// 把 embedded 钱包里的 SPL token 转给另一个地址。
//
// # 它为什么在这个 harness 里
//
// 这个页面原本只会「买」和「卖」——钱进得来、币换得动，但**钱出不去**。
// business 的对外面上确实有提现（`/v1/withdrawals/chain/*`），可那条路
// 契约里写着「生产网络默认全部关闭」，而且它是一条 prepare/submit 的
// 完整流程，harness 一行都没实现。于是每次跑完实跑，钱就留在那只
// embedded 钱包里，换一个身份就再也够不着（旧钱包私钥没有助记词，
// Privy 的导入只认助记词——ADR-0010「代价一」）。
//
// 所以这里有一个**直接的、不经过服务端的**转账：组一笔 SPL transfer，
// 交给 Privy 签名并广播。它不是搬家脚手架，是常驻功能。
//
// # 广播由 Privy 做，不是我们
//
// 用 `useSignAndSendTransaction`（`@privy-io/react-auth/solana`）。
// 少写的那部分恰好是最容易写错的部分：blockhash 过期后的重试、commitment
// 等级、以及「发出去了但确认超时」与「根本没发出去」怎么区分。写错了不会
// 报错，只会让人以为是签名坏了。
//
// **这不违反 ADR-0010 决定二**（「广播必须由服务端做」）。那条守的是 meme
// 交易的账本不变式：一笔查不到的链上交易是 ADR-0009 的反例。而这笔转账
// 不进 `trades`、不产生分录、服务端从头到尾不知情——它对账本的影响与
// 用户自己在钱包 App 里转一笔完全相同。
//
// # 只认经典 SPL Token program
//
// Token-2022 的 mint 显式拒绝，见 fetchMintInfo。它不是"暂不支持"的托词：
// Token-2022 的 transfer hook / 手续费扩展会改变转账语义，拿经典 program
// 的指令去组包，链上回一句看不懂的话，而那句话不指向 program 选错了。

import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';

import {fromBase64} from './signature';

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;

// ─────────────────────────────────────────────────────────────────────
// 纯函数：金额换算与地址校验。这一层没有 I/O，是本模块唯一有测试的部分。

/**
 * 十进制串 → 最小单位。`balance.ts` 的 `formatUnits` 的逆。
 *
 * # 小数位超了一律报错，**绝不截断**
 *
 * 截断是这段代码最容易犯、也最难发现的错：用户输 `1.2345678`（USDC 只有
 * 6 位），截断成 `1.234567` 就是**少转了钱**，而页面上一切正常、链上也
 * 成功。报错难看，但它至少出现在转账之前。
 *
 * # 全程 BigInt
 *
 * 与 `formatUnits` 同一条判据（见 balance.ts）：金额一碰浮点就会在某个
 * token 上丢精度，而丢精度的症状是"差了几个最小单位"，看起来像手续费。
 */
export function parseUnits(input: string, decimals: number): bigint {
  const s = input.trim();
  if (s === '') throw new Error('金额不能为空');
  // 科学计数法、正负号、千分位一律拒绝：它们都有"看起来解析对了"的解法，
  // 而任何一种猜测都可能把金额改成另一个数。
  if (!/^\d*\.?\d*$/.test(s) || !/\d/.test(s)) {
    throw new Error(`金额 ${input} 不是十进制数字（不接受符号、科学计数法、千分位）`);
  }
  const [int, frac = ''] = s.split('.');
  if (frac.length > decimals) {
    throw new Error(
      `金额 ${input} 有 ${frac.length} 位小数，而这个 token 只有 ${decimals} 位 —— ` +
        `截掉多出来的位等于少转钱，所以这里拒绝而不是四舍五入`,
    );
  }
  return BigInt((int || '0') + frac.padEnd(decimals, '0'));
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * base58 解码。失败回 null，**不抛** —— 调用方在输入框每次按键时都要问它。
 *
 * **前导 `1` 必须单独数。** base58 里一个前导 `1` 代表一个零字节，而按
 * 权展开的大整数会把它们全吃掉：`11111111111111111111111111111111`
 * （系统 program，32 个零字节）算出来是 0，只有一个字节。漏了这一步，
 * 一批合法地址会被判成非法，而它们恰恰是最特殊的那几个。
 */
export function decodeBase58(s: string): Uint8Array | null {
  if (s === '') return null;
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const body: number[] = [];
  while (n > 0n) {
    body.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  let zeros = 0;
  for (const c of s) {
    if (c !== '1') break;
    zeros++;
  }
  return new Uint8Array([...new Array<number>(zeros).fill(0), ...body]);
}

/**
 * base58 编码。`signAndSendTransaction` 回的交易签名是 64 字节裸字节，
 * 而浏览器里的交易 hash 是它的 base58 —— 不编码就拼不出可点的链接，
 * 而"广播成功了但看不到那笔"是这个页面最没用的一种成功。
 *
 * 前导零字节要编成前导 `1`，与解码那一侧对称。两边只有一侧处理前导零的话，
 * 往返就不闭合，而不闭合的表现是**偶尔**有一笔链接点不开（零字节开头的
 * 签名大约 1/256）。
 */
export function encodeBase58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  let zeros = '';
  for (const b of bytes) {
    if (b !== 0) break;
    zeros += '1';
  }
  return zeros + out;
}

/**
 * Solana 地址 = 32 字节的 ed25519 公钥。长度不对就不是地址。
 *
 * **它挡不住「粘贴少一位」，这一点必须说破。** 44 个 base58 字符去掉一个，
 * 解出来仍然可能是 32 字节（43 个字符最大约 2^251.8，照样落在区间里），
 * 所以「长度对」≠「地址是你想的那个」。这不是可以修的：任意 32 字节都是
 * 一个语法合法的地址，离线无从判断收款人是谁。
 *
 * 真正挡这一类的是 `fetchDestInfo` 的**链上存在性** —— 手滑出来的地址
 * 几乎必然查无此账户。那道闸在 UI 上必须显眼，否则这里就是个洞。
 * 用例钉在 transfer.test.ts 的「挡不住『粘贴少一位』」那条。
 */
export function isSolanaAddress(s: string): boolean {
  const b = decodeBase58(s.trim());
  return b !== null && b.length === 32;
}

export type DestCheck = {ok: true} | {ok: false; why: string};

/**
 * 目标地址的准入。**这是转错钱之前唯一的一道闸**，所以它宁可啰嗦。
 *
 * 自转单独判：它不会亏掉本金，但会白付一笔手续费，而页面上的表现是
 * "转成功了、余额没变"——那看起来像转账根本没生效，人会再点一次。
 */
export function checkDestination(dest: string, self: string): DestCheck {
  const d = dest.trim();
  if (d === '') return {ok: false, why: '目标地址为空'};
  if (!isSolanaAddress(d)) {
    return {ok: false, why: '不是合法的 Solana 地址（base58 解出来必须是 32 字节）'};
  }
  if (d === self.trim()) {
    return {ok: false, why: '目标就是这只钱包自己 —— 转给自己只会白付一笔手续费'};
  }
  return {ok: true};
}

// ─────────────────────────────────────────────────────────────────────
// I/O：问 RPC。与 balance.ts 同一条路（同一个端点、同样的 JSON-RPC 形状）。

/**
 * 经典 SPL Token program。Token-2022 是另一个，见下。
 *
 * **从 `@solana-program/token` 取，不手抄字面量** —— 手抄一份的话，
 * 判定用的地址与组指令用的地址是两个来源，而它们不一致时的症状是
 * 「这个币明明支持却说不支持」，没人会想到去比对两个常量。
 */
export const TOKEN_PROGRAM: string = TOKEN_PROGRAM_ADDRESS;
/** Token-2022。本模块**显式拒绝**它，理由见文件头。 */
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
/** 系统 program。目标地址若被它拥有，就是一个普通钱包。 */
export const SYSTEM_PROGRAM = '11111111111111111111111111111111';

export type MintInfo = {
  /** 这个 mint 归哪个 program 管。 */
  program: string;
  /** 小数位，从链上读，不写死。 */
  decimals: number;
  /** 是不是我们支持的那一个。false 时 why 说明为什么。 */
  supported: boolean;
  why?: string;
};

async function rpc<T>(method: string, params: unknown[], signal?: AbortSignal): Promise<T> {
  if (!RPC_URL) throw new Error('没有配 NEXT_PUBLIC_SOLANA_RPC_URL');
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    signal,
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const body = (await res.json()) as {error?: {code: number; message: string}; result?: T};
  // JSON-RPC 的错误装在 200 里（与 business 那个恒 200 信封同形）。
  if (body.error) throw new Error(`RPC ${body.error.code} ${body.error.message}`);
  return body.result as T;
}

/**
 * 读一个 mint 的 program 与 decimals。
 *
 * **decimals 一定要从链上读**，不能按 token 猜。写死 6 在 USDC 上永远对，
 * 换个 mint 就错三个数量级，而错出来的金额是个合法数字，没有一处会报错。
 */
export async function fetchMintInfo(mint: string, signal?: AbortSignal): Promise<MintInfo> {
  if (!isSolanaAddress(mint)) throw new Error(`mint ${mint} 不是合法的 Solana 地址`);
  const r = await rpc<{
    value: {owner?: string; data?: {parsed?: {type?: string; info?: {decimals?: number}}}} | null;
  }>('getAccountInfo', [mint, {encoding: 'jsonParsed', commitment: 'confirmed'}], signal);
  if (!r.value) throw new Error(`链上没有 ${mint} 这个账户 —— 地址对吗？`);
  const owner = r.value.owner ?? '';
  const parsed = r.value.data?.parsed;
  if (parsed?.type !== 'mint') {
    // 把 token account、钱包地址当成 mint 传进来是很常见的手滑，
    // 而它们在下一步会表现成一句关于指令编码的错误。
    throw new Error(`${mint} 不是一个 mint（链上它是 ${parsed?.type ?? '未知类型'}）`);
  }
  const decimals = parsed.info?.decimals ?? 0;
  if (owner === TOKEN_2022_PROGRAM) {
    return {
      program: owner,
      decimals,
      supported: false,
      why:
        '这是 Token-2022 的 mint。本页只组经典 SPL Token 的指令 —— Token-2022 ' +
        '的 transfer hook 与手续费扩展会改变转账语义，用错 program 组包，' +
        '链上回的是一句不指向这里的错误',
    };
  }
  if (owner !== TOKEN_PROGRAM) {
    return {program: owner, decimals, supported: false, why: `未知的 token program：${owner}`};
  }
  return {program: owner, decimals, supported: true};
}

export type DestInfo = {
  /** 目标账户在链上存不存在。不存在也能收钱（转 SPL 会顺带建 ATA）。 */
  exists: boolean;
  /** 拥有它的 program。系统 program = 普通钱包。 */
  owner: string;
  /** 它是不是一个普通钱包（而不是 mint / token account / 合约）。 */
  isWallet: boolean;
  /** 目标名下该 mint 的 ATA 是否已存在。false 时这笔转账会顺带建一个。 */
  hasAta: boolean;
};

/**
 * 转账前把目标地址的链上形态查出来给人看。
 *
 * **这是「地址全文显示」之外的第二道人工闸。** 转错地址不可逆，而肉眼比
 * 对 44 个 base58 字符的可靠性很低；「它是一个普通钱包、已经有这个币的
 * 账户」这句话能挡住一大类错误——比如把 mint 地址、或某个合约地址当成
 * 收款地址粘进来。
 */
export async function fetchDestInfo(
  dest: string,
  mint: string,
  signal?: AbortSignal,
): Promise<DestInfo> {
  const acc = await rpc<{value: {owner?: string} | null}>(
    'getAccountInfo',
    [dest, {encoding: 'jsonParsed', commitment: 'confirmed'}],
    signal,
  );
  const owner = acc.value?.owner ?? '';
  const ata = await rpc<{value: unknown[]}>(
    'getTokenAccountsByOwner',
    [dest, {mint}, {encoding: 'jsonParsed', commitment: 'confirmed'}],
    signal,
  );
  return {
    exists: acc.value !== null,
    owner,
    isWallet: owner === SYSTEM_PROGRAM,
    hasAta: (ata.value ?? []).length > 0,
  };
}

/**
 * 组一笔 SPL transfer 的**未签名**交易，回线格式字节。
 *
 * 签名与广播都不在这里 —— 调用方把这串字节交给
 * `useSignAndSendTransaction`，Privy 签完自己发（理由见文件头）。
 *
 * # 为什么无条件带上「建 ATA」那条指令
 *
 * 用的是 `getCreateAssociatedTokenIdempotentInstruction` —— **幂等**版本：
 * 目标 ATA 已存在时它是个空操作。所以这里不写「先查再决定加不加」的分支。
 *
 * 分支版本有一个真实的失败模式：查的时候不存在、组包时加了建账户指令，
 * 或者反过来查的时候存在、组包时没加而它在这中间被关掉了。两种都表现为
 * 一笔在链上失败的交易，而错误信息谈的是账户，不谈那个竞态。幂等指令把
 * 这个窗口整个消掉，代价只是几百个计算单元。
 *
 * # 为什么是 transferChecked 而不是 transfer
 *
 * `transferChecked` 把 decimals 一起写进指令，链上会核对。万一我们把
 * decimals 读错（比如换了 mint 却用了上一个的位数），它当场失败；
 * 用 `transfer` 的话那笔会**成功**，只是金额差几个数量级。
 */
export async function buildSplTransfer(p: {
  /** 出款钱包（也是手续费付款方与 ATA 的 rent 付款方）。 */
  owner: string;
  /** 收款钱包地址（不是它的 ATA —— ATA 由这里自己派生）。 */
  dest: string;
  mint: string;
  /** 最小单位。用 parseUnits 从人输入的十进制串换出来。 */
  amount: bigint;
  /** 从链上读到的 decimals，见 fetchMintInfo。 */
  decimals: number;
}): Promise<Uint8Array> {
  if (!RPC_URL) throw new Error('没有配 NEXT_PUBLIC_SOLANA_RPC_URL');
  const owner = address(p.owner);
  const dest = address(p.dest);
  const mint = address(p.mint);
  const signer = createNoopSigner(owner);

  const [from] = await findAssociatedTokenPda({
    owner,
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const [to] = await findAssociatedTokenPda({
    owner: dest,
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const rpc = createSolanaRpc(RPC_URL);
  const {value: blockhash} = await rpc.getLatestBlockhash().send();

  const wire = pipe(
    createTransactionMessage({version: 0}),
    (tx) => setTransactionMessageFeePayer(owner, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(blockhash, tx),
    (tx) =>
      appendTransactionMessageInstructions(
        [
          getCreateAssociatedTokenIdempotentInstruction({
            payer: signer,
            ata: to,
            owner: dest,
            mint,
          }),
          getTransferCheckedInstruction({
            source: from,
            mint,
            destination: to,
            authority: signer,
            amount: p.amount,
            decimals: p.decimals,
          }),
        ],
        tx,
      ),
    (tx) => compileTransaction(tx),
    (tx) => getBase64EncodedWireTransaction(tx),
  );
  // **不要用 `Buffer.from(wire, 'base64')`** —— 官方 starter 是那么写的，
  // 但它靠自己 vite 配置里的 nodePolyfills() 才跑得起来。我们的 vite 没有
  // 那个插件，照抄过来是运行期的 `Buffer is not defined`，而 typecheck
  // 一声不吭（@types/node 让它编译通过）。
  return fromBase64(wire);
}
