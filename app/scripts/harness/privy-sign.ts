/**
 * 03 号的验收脚本：证明 Node 这一侧**真的签得动**已授权的 embedded 钱包。
 *
 * # 怎么跑
 *
 *     PRIVY_APP_ID=<当前环境那个 app id> \
 *     PRIVY_APP_SECRET=<控制台里的 app secret> \
 *     PRIVY_AUTHZ_KEY=~/workspace/smartx/meme/smartx-backend/keys/privy_authz_p256.pem \
 *     PRIVY_EVM_WALLET_ID=<页面上「服务端代签授权」显示的那个 wallet id> \
 *     PRIVY_EVM_ADDRESS=<那只钱包的地址> \
 *     npx pnpm@10 run harness:privy-sign
 *
 * （源仓库这一行是 `npx vite-node scripts/privy-sign.ts`，换 tsx 的理由见 `probe.ts` 头部。）
 *
 * Solana 那侧可选，多给两个变量就一起验：
 *
 *     PRIVY_SOL_WALLET_ID=<...>
 *
 * ⚠ **这个脚本要 app secret 与 P-256 联签私钥，是私钥审批线上的动作。**
 * 它签的是真钱包，不是 mock。CI 上不要跑它，也不要把这些变量写进任何 `.env*`
 * 文件 —— 它们没有 `NEXT_PUBLIC_` 前缀，但 `.env.local` 依然是一份躺在磁盘上
 * 的明文。被签的模块为什么放在 `scripts/harness/` 而不是 `src/`，见 `privySign.ts`
 * 头部「迁到 Next 之后，护栏换了一种」。
 *
 * # EVM 这一侧验的是什么
 *
 * 签一段摘要，然后**对签名做 ecrecover，看恢复出的地址等不等于钱包地址**。
 * 只看「HTTP 200」是不够的：签错了钥匙、签错了钱包都会回 200，而错法要到
 * 链上才暴露成一句 AA24，那句话指向签名校验，看起来像钥匙有问题。
 *
 * # Solana 这一侧为什么故意递一笔解不开的交易
 *
 * 与后端仓那个 smoke test 同一个思路：这一步要分辨的只有两种回答 ——
 * 「你没有权限签」（那就是没挂 signer）与「这笔交易我看不懂」（那说明签得动，
 * 只是我给的数据不对）。后者就是通过。
 */

import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';

import {recoverSigner} from '../../src/features/harness/adr0017';
import {
  configFromEnv,
  createPrivySigner,
  type PrivySignerConfig,
  type PrivyTiming,
} from './privySign';

/** `~` 开头的路径 Node 不认，得自己展开 —— 不展开的话报的是「文件不存在」。 */
function expandHome(p: string): string {
  return p.startsWith('~/') ? `${homedir()}/${p.slice(2)}` : p;
}

const keyPath = process.env.PRIVY_AUTHZ_KEY ?? '';
if (!keyPath) {
  console.error('缺 PRIVY_AUTHZ_KEY（P-256 授权私钥的文件路径）');
  process.exit(2);
}

let pem: string;
try {
  pem = readFileSync(expandHome(keyPath), 'utf8');
} catch (e) {
  console.error(`读授权私钥失败（${keyPath}）：${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}

function loadConfig(): PrivySignerConfig {
  try {
    return configFromEnv({...process.env, PRIVY_AUTHZ_KEY_PEM: pem});
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
}
const cfg = loadConfig();

const timings: PrivyTiming[] = [];
const signer = createPrivySigner(cfg, {onTiming: (t) => timings.push(t)});

const evmWalletId = process.env.PRIVY_EVM_WALLET_ID ?? '';
const evmAddress = process.env.PRIVY_EVM_ADDRESS ?? '';
const solWalletId = process.env.PRIVY_SOL_WALLET_ID ?? '';

/** 一段固定的 32 字节摘要。内容无所谓，它只是被签的东西。 */
const DIGEST = `0x${'11'.repeat(32)}` as const;

function reportTimings(): void {
  if (timings.length === 0) return;
  console.log('');
  console.log('Privy 签名接口耗时（**不属于后端延迟**，报告里要单独成列）：');
  for (const t of timings) {
    const ms = (t.completedAt - t.startedAt).toFixed(1);
    console.log(`  ${t.method.padEnd(16)} ${ms}ms  HTTP ${t.status ?? '-'}  ${t.ok ? 'ok' : '失败'}`);
  }
}

async function checkEvm(): Promise<boolean> {
  if (!evmWalletId || !evmAddress) {
    console.log('EVM：跳过（没给 PRIVY_EVM_WALLET_ID / PRIVY_EVM_ADDRESS）');
    return true;
  }
  console.log(`EVM：对摘要 ${DIGEST.slice(0, 10)}… 签名，钱包 ${evmWalletId}`);
  const sig = await signer.signEvmDigest(evmWalletId, DIGEST);
  console.log(`  拿到签名 ${sig.slice(0, 12)}…（${(sig.length - 2) / 2} 字节）`);

  const recovered = await recoverSigner(DIGEST, sig);
  const want = evmAddress.toLowerCase();
  const ok = recovered.toLowerCase() === want;
  console.log(`  ecrecover → ${recovered}`);
  console.log(`  钱包地址   → ${evmAddress}`);
  if (ok) {
    console.log('  ✓ 一致 —— 服务端确实用这只钱包签的');
  } else {
    // 两个都打出来而不是只说"不一致"：签错钱包与签错钥匙的地址长得不一样，
    // 而分辨它们靠的就是这两个串。
    console.log('  ✗ 不一致 —— 签出来的不是这只钱包。核对 wallet id 与地址是不是同一只');
  }
  return ok;
}

async function checkSolana(): Promise<boolean> {
  if (!solWalletId) {
    console.log('Solana：跳过（没给 PRIVY_SOL_WALLET_ID）');
    return true;
  }
  // 96 个零字节：合法的 base64，但不是一笔能解开的交易。
  const fake = Buffer.alloc(96).toString('base64');
  console.log(`Solana：递一笔故意解不开的交易，钱包 ${solWalletId}`);
  try {
    const signed = await signer.signSolanaTransaction(solWalletId, fake);
    console.log(`  ✓ 居然签成了（${signed.slice(0, 12)}…）—— 也算通过，权限肯定是有的`);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/HTTP 401|HTTP 403/.test(msg)) {
      console.log('  ✗ 没有权限 —— 这只 Solana 钱包还没挂 signer，去页面上授权一次');
      return false;
    }
    // 400 之类的"这笔交易我看不懂"正是我们要的答案。
    console.log(`  ✓ 被拒但不是权限问题，说明签得动。原话：${msg.slice(0, 160)}`);
    return true;
  }
}

async function main(): Promise<void> {
  console.log(`Privy app：${cfg.appId}`);
  const evmOk = await checkEvm();
  const solOk = await checkSolana();
  reportTimings();
  if (!evmOk || !solOk) process.exit(1);
}

main().catch((e: unknown) => {
  reportTimings();
  console.error('');
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
