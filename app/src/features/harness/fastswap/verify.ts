// 签名前后的核对（fastswap-app.md §4、§5、§6；fastswap.md §5）。
//
// 平台预签 + 用户只签，是 v2 最核心的信任边界：服务端交来一份**已经带着平台签名**
// 的交易（或一份 EIP-712 批次），用户的钥匙只在它身上落一个签名。这一层回答两件事：
//   ① 签之前：交来的东西是不是这笔 intent、这个 revision、这只钱包该签的那一份；
//   ② 签之后：钱包签的是不是**那一份**，而且没有改动任何一个字节。
//
// 每一项核对都产出一条带编号的结果，UI 逐条展示；任一不过就不签 / 不上报。

import {VersionedTransaction} from '@solana/web3.js';
import {hashMessage, hashTypedData, recoverAddress, type Hex} from 'viem';

import {hash7702Authorization, normalizeAddress, sameAddress} from '../adr0017';
import {fromBase64, toHex} from '../signature';
import {
  EvmSigningMethod,
  PreparationStatus,
  SigningKind,
  type CreateIntent,
  type EvmSigning,
  type SolanaSigning,
  type SwapSnapshot,
} from './wire';

export type Check = {id: string; ok: boolean; detail: string};

export function failed(checks: readonly Check[]): Check[] {
  return checks.filter((c) => !c.ok);
}

/** 投入是原生币的两种写法（与后端 isNativeEVMAsset 同）。 */
const NATIVE_EVM = ['0x0000000000000000000000000000000000000000', '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'];
/** Calibur 实现合约与执行器（后端 relay/evm/calibur/calibur.go）。 */
export const CALIBUR_IMPLEMENTATION = '0x000000009b1d0af20d8c6d0a44e162d11f9b8f00';
export const MULTICALL3 = '0xca11bde05977b3631167028862be2a173976ca11';
export const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3';
const MAX_UINT256 = (1n << 256n) - 1n;
const SEL_APPROVE = '0x095ea7b3';
const SEL_TRANSFER = '0xa9059cbb';
const SEL_TRANSFER_FROM = '0x23b872dd';

/** `eip155:56` → 56；认不出返回 null。 */
export function evmChainIdOf(caip: string): number | null {
  const m = /^eip155:(\d+)$/.exec(caip);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// §4 签名前的七条
// ---------------------------------------------------------------------------

export type PreSignContext = {
  snapshot: SwapSnapshot;
  /** 用户确认时本地持有的 intent（发给 create 的那一份）。 */
  intent: CreateIntent;
  /** 这笔要用来签名的钱包地址（Solana 或 EVM）。 */
  walletAddress: string;
  /** 收到这份快照时的本地单调时刻（ms）。READY 档的 retry_after_ms 从它起算。 */
  receivedAt: number;
  now: number;
  /** 页面在前台。 */
  visible: boolean;
  /** 本地已存着这笔 swap 的、还没确认上报成功的签名产物。 */
  hasUnreportedArtifact: boolean;
  /** 用户确认时能接受的最低到账（原子数）。缺席 = 不比。 */
  acceptedMinOutRaw: string | null;
};

/**
 * intent 的一个字段"是不是同一个东西"。
 *
 * **EVM 资产地址按大小写不敏感比**：EIP-55 的大小写是校验和，不是身份的一部分，
 * 服务端在建单入口就把它归一成小写（后端 `address_case_e2e_test.go` 钉着这条）。
 * 逐字节比的那一版，用户从代币列表里拷一个校验和写法的地址进来，建单成功、
 * 签前第 1 条却说"快照里的 intent 与本地确认的不一致"，而两边指的是同一个币
 * （2026-09-18 的 0203c74b）。
 *
 * **Solana 的 mint 仍逐字节比**：base58 大小写敏感，改一个字母就是另一个 mint ——
 * 在这一侧放松等于把"填错了币"放过去。
 */
function intentFieldSame(mine: CreateIntent, theirs: CreateIntent, k: keyof CreateIntent): boolean {
  const evmAsset =
    (k === 'origin_asset' && evmChainIdOf(mine.origin_chain) !== null) ||
    (k === 'destination_asset' && evmChainIdOf(mine.destination_chain) !== null);
  return evmAsset ? sameAddress(String(theirs[k]), String(mine[k])) : String(theirs[k]) === String(mine[k]);
}

export function preSignChecks(c: PreSignContext): Check[] {
  const s = c.snapshot;
  const rev = s.revision;
  const out: Check[] = [];

  // 1. 账户 / 钱包 / intent 与本地确认的一致
  const intentDiff = (Object.keys(c.intent) as (keyof CreateIntent)[]).filter((k) => !intentFieldSame(c.intent, s.intent, k));
  const signer = rev.solana?.user_signer_address ?? rev.evm?.signer_address ?? '';
  const walletOk = rev.solana ? signer === c.walletAddress : sameAddress(signer, c.walletAddress);
  out.push({
    id: '1-intent-wallet',
    ok: intentDiff.length === 0 && walletOk,
    detail:
      intentDiff.length > 0
        ? `快照里的 intent 与本地确认的不一致：${intentDiff.join(', ')}`
        : walletOk
          ? `intent 一致；签名者 ${signer} 就是本页选中的钱包`
          : `revision 点名的签名者是 ${signer || '(空)'}，本页的钱包是 ${c.walletAddress}`,
  });

  // 2. READY 且 current_revision 就是这一版
  const ready = s.preparation.status === PreparationStatus.READY;
  const revMatch = s.preparation.current_revision === rev.revision && rev.revision !== '' && rev.revision !== '0';
  out.push({
    id: '2-ready-revision',
    ok: ready && revMatch,
    detail: `preparation.status=${s.preparation.status}，current_revision=${s.preparation.current_revision}，revision=${rev.revision}`,
  });

  // 3. intent_hash 一致
  out.push({
    id: '3-intent-hash',
    ok: rev.intent_hash !== '' && rev.intent_hash === s.intent_hash,
    detail: `revision.intent_hash=${rev.intent_hash || '(空)'}，swap.intent_hash=${s.intent_hash || '(空)'}`,
  });

  // 4. 恰好一份已支持的签名材料
  const both = !!rev.solana && !!rev.evm;
  const sol = !!rev.solana && rev.solana.kind === SigningKind.SOLANA_TRANSACTION;
  const evm = !!rev.evm && rev.evm.kind === SigningKind.EVM_CALIBUR;
  out.push({
    id: '4-one-material',
    ok: !both && (sol || evm),
    detail: both
      ? 'solana 与 evm 同时在场'
      : sol
        ? 'solana_transaction'
        : evm
          ? 'evm_calibur'
          : `没有已支持的材料（solana.kind=${rev.solana?.kind ?? '-'}，evm.kind=${rev.evm?.kind ?? '-'}）`,
  });

  // 5. 还在可签期限内，且页面在前台。用 retry_after_ms 而不是本机时钟减 safe_sign_before（§2.1）
  const left = s.preparation.retry_after_ms == null ? null : s.preparation.retry_after_ms - (c.now - c.receivedAt);
  out.push({
    id: '5-deadline-foreground',
    ok: left != null && left > 0 && c.visible,
    detail: !c.visible
      ? '页面不在前台'
      : left == null
        ? '服务端没给剩余可签时间（READY 档缺 retry_after_ms = 已过点）'
        : left > 0
          ? `还能签 ${(left / 1000).toFixed(1)}s`
          : `已过可签期限 ${(-left / 1000).toFixed(1)}s`,
  });

  // 6. 本地没有未上报的签名产物
  out.push({
    id: '6-no-pending-artifact',
    ok: !c.hasUnreportedArtifact,
    detail: c.hasUnreportedArtifact ? '本地已存着这笔的签名产物，应先上报它，不得重签' : '本地没有待上报产物',
  });

  // 7. 最低到账仍满足用户确认的约束
  let minOk = true;
  let minDetail = '用户没有给出最低到账约束';
  if (c.acceptedMinOutRaw != null) {
    try {
      minOk = BigInt(rev.min_out_raw) >= BigInt(c.acceptedMinOutRaw);
      minDetail = `revision.min_out_raw=${rev.min_out_raw}，用户接受的下限=${c.acceptedMinOutRaw}`;
    } catch {
      minOk = false;
      minDetail = `min_out_raw 不是整数：${rev.min_out_raw}`;
    }
  }
  out.push({id: '7-min-out', ok: minOk, detail: minDetail});

  return out;
}

/**
 * 签前第 7 条的底线：展示报价的底价**再让一个滑点带**（向下取整）。
 *
 * 严格比「建单底价 ≥ 报价底价」在真链上会频繁误拦（2026-09-18，82a2caac）：展示报价走
 * 结算方 /price，建单走 /quote/v2，口径不同（建单另算抽成、租金），再加一两秒的价格漂移，
 * 建单底价常常略低。链上兜底的始终是 revision.min_out_raw；这条只挡「比用户看到的价差出一个
 * 滑点带以上」的恶化。
 */
export function acceptedMinOut(quoteMinOutRaw: string, slippageBps: number): string {
  return ((BigInt(quoteMinOutRaw) * BigInt(10_000 - slippageBps)) / 10_000n).toString();
}

// ---------------------------------------------------------------------------
// Solana：签前解码核对、签后逐字节核对
// ---------------------------------------------------------------------------

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return toHex(d).slice(2);
}

async function ed25519Verify(pub: Uint8Array, sig: Uint8Array, msg: Uint8Array): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', pub as BufferSource, {name: 'Ed25519'}, false, ['verify']);
  return crypto.subtle.verify({name: 'Ed25519'}, key, sig as BufferSource, msg as BufferSource);
}

const isZero = (b: Uint8Array | undefined) => !b || b.every((x) => x === 0);

export type SolanaDecoded = {tx: VersionedTransaction; message: Uint8Array; userIndex: number; feePayerIndex: number};

export async function solanaPreSign(sign: SolanaSigning): Promise<{checks: Check[]; decoded: SolanaDecoded | null}> {
  const checks: Check[] = [];
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(fromBase64(sign.transaction_base64));
  } catch (e) {
    return {checks: [{id: 'sol-decode', ok: false, detail: `交易解不开：${String(e)}`}], decoded: null};
  }
  const message = new Uint8Array(tx.message.serialize());
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  const nSigners = tx.message.header.numRequiredSignatures;

  const hash = await sha256Hex(message);
  checks.push({
    id: 'sol-message-hash',
    ok: hash === sign.message_hash.toLowerCase(),
    detail: `sha256(message)=${hash}，服务端给的 message_hash=${sign.message_hash}`,
  });

  const feePayerIndex = keys.indexOf(sign.fee_payer_address);
  checks.push({
    id: 'sol-fee-payer',
    ok: feePayerIndex === 0,
    detail: `fee_payer_address=${sign.fee_payer_address}，交易的第 0 个账户=${keys[0]}`,
  });

  const userIndex = keys.indexOf(sign.user_signer_address);
  checks.push({
    id: 'sol-user-signer',
    ok: userIndex >= 0 && userIndex < nSigners && userIndex !== feePayerIndex,
    detail:
      userIndex < 0
        ? `user_signer_address=${sign.user_signer_address} 不在账户表里`
        : `用户在第 ${userIndex} 槽（需签名的共 ${nSigners} 槽）`,
  });

  checks.push({
    id: 'sol-blockhash',
    ok: tx.message.recentBlockhash === sign.blockhash,
    detail: `message.recentBlockhash=${tx.message.recentBlockhash}，revision.blockhash=${sign.blockhash}`,
  });

  // 平台预签：fee payer 那一槽必须已经有一个**对这段 message 有效**的签名；用户那一槽必须空着。
  let presignOk = false;
  if (feePayerIndex === 0 && !isZero(tx.signatures[0])) {
    presignOk = await ed25519Verify(tx.message.staticAccountKeys[0]!.toBytes(), tx.signatures[0]!, message);
  }
  checks.push({
    id: 'sol-platform-presign',
    ok: presignOk,
    detail: presignOk ? '代付方签名已在场且验签通过' : '代付方那一槽为空或验签不过',
  });
  checks.push({
    id: 'sol-user-slot-empty',
    ok: userIndex >= 0 && isZero(tx.signatures[userIndex]),
    detail: userIndex >= 0 && isZero(tx.signatures[userIndex]) ? '用户那一槽空着' : '用户那一槽已经有内容',
  });

  // 地址查找表：交易引用的每张表都必须在 revision.lookup_tables 里，且被引用的下标在表内。
  const lookups = tx.message.addressTableLookups;
  const tables = new Map(sign.lookup_tables.map((t) => [t.address, t.addresses]));
  const bad = lookups.filter((l) => {
    const t = tables.get(l.accountKey.toBase58());
    return !t || [...l.writableIndexes, ...l.readonlyIndexes].some((i) => i >= t.length);
  });
  checks.push({
    id: 'sol-lookup-tables',
    ok: bad.length === 0,
    detail:
      lookups.length === 0
        ? '交易不引用地址查找表'
        : bad.length === 0
          ? `引用的 ${lookups.length} 张表都在 revision.lookup_tables 里`
          : `这几张表没给或下标越界：${bad.map((l) => l.accountKey.toBase58()).join(', ')}`,
  });

  return {checks, decoded: {tx, message, userIndex, feePayerIndex}};
}

/** 签后：message 字节不变、平台签名未被覆盖、用户签名在场且有效。 */
export async function solanaPostSign(
  before: SolanaDecoded,
  signedWire: Uint8Array,
): Promise<{checks: Check[]; signedBase64: string | null}> {
  const checks: Check[] = [];
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(signedWire);
  } catch (e) {
    return {checks: [{id: 'sol-signed-decode', ok: false, detail: `签好的交易解不开：${String(e)}`}], signedBase64: null};
  }
  const message = new Uint8Array(tx.message.serialize());
  const same = message.length === before.message.length && message.every((b, i) => b === before.message[i]);
  checks.push({id: 'sol-message-unchanged', ok: same, detail: same ? 'message 逐字节未变' : '钱包改动了 message 字节'});

  const platformBefore = before.tx.signatures[before.feePayerIndex]!;
  const platformAfter = tx.signatures[before.feePayerIndex];
  const platformKept = !!platformAfter && platformAfter.every((b, i) => b === platformBefore[i]);
  checks.push({
    id: 'sol-platform-kept',
    ok: platformKept,
    detail: platformKept ? '平台签名原样保留' : '平台签名被覆盖或清空',
  });

  const userSig = tx.signatures[before.userIndex];
  let userOk = false;
  if (same && !isZero(userSig)) {
    userOk = await ed25519Verify(tx.message.staticAccountKeys[before.userIndex]!.toBytes(), userSig!, message);
  }
  checks.push({id: 'sol-user-signature', ok: userOk, detail: userOk ? '用户签名验签通过' : '用户签名缺席或验签不过'});

  let b64 = '';
  for (const b of signedWire) b64 += String.fromCharCode(b);
  return {checks, signedBase64: failed(checks).length === 0 ? btoa(b64) : null};
}

// ---------------------------------------------------------------------------
// EVM / Calibur：签前复核 typed data 与批次边界、签后 ecrecover
// ---------------------------------------------------------------------------

type ServerTypedData = NonNullable<EvmSigning['requests'][number]['typed_data']>;

/**
 * **交给钱包去签的那一份：types 原样带上 EIP712Domain。**
 *
 * 2026-09-18 踩到的：从前这里把 EIP712Domain 摘掉（viem 自己会从 domain 推），
 * 于是"域类型长什么样"由钱包那侧推断。而服务端的 domain 是 protobuf Struct
 * 编出来的，**键是字母序**（chainId, name, salt, verifyingContract, version）——
 * 谁要是按键序声明域类型，算出来的 domainSeparator 与规范序
 * （name, version, chainId, verifyingContract, salt）完全不同：
 *
 *     规范序   0x82f0d74b…（服务端、viem、go-ethereum 三方一致）
 *     字母序   0xd6bdb71c…
 *
 * 症状是签名本身完全合法、ecrecover 出一个谁也不认识的地址（0x9324fb48…），
 * 而钱包列表里根本没有那个地址 —— 三个方向（钥匙错 / 摘要错 / 签名格式错）
 * 的排查全都指不回"域类型的字段顺序"。带上 EIP712Domain 就没有推断这一步。
 */
export function typedDataToSign(td: ServerTypedData) {
  return {domain: td.domain, types: td.types, primaryType: td.primary_type, message: td.message};
}

/** 本地复核用：去掉 EIP712Domain，让 viem 按规范序自己推。两者的摘要必须相同（用例钉住）。 */
export function typedDataForWallet(td: ServerTypedData) {
  const {EIP712Domain: _domain, ...types} = td.types;
  return {domain: td.domain, types, primaryType: td.primary_type, message: td.message};
}

type Call = {to: string; value: string; data: string};

export function evmPreSign(evm: EvmSigning, intent: CreateIntent, walletAddress: string): Check[] {
  const checks: Check[] = [];
  const chainId = evmChainIdOf(intent.origin_chain);

  checks.push({
    id: 'evm-signer',
    ok: sameAddress(evm.signer_address, walletAddress) && evm.chain === intent.origin_chain,
    detail: `signer=${evm.signer_address}，钱包=${walletAddress}，chain=${evm.chain}`,
  });

  const known = new Set(['calibur_batch', 'authorization_7702']);
  const batch = evm.requests.filter((r) => r.request_id === 'calibur_batch');
  const auths = evm.requests.filter((r) => r.request_id === 'authorization_7702');
  const unknown = evm.requests.filter((r) => !known.has(r.request_id));
  checks.push({
    id: 'evm-requests',
    ok:
      batch.length === 1 &&
      batch[0]!.method === EvmSigningMethod.SIGN_TYPED_DATA_V4 &&
      !!batch[0]!.typed_data &&
      auths.length <= 1 &&
      auths.every((a) => a.method === EvmSigningMethod.EIP7702_AUTHORIZATION && !!a.authorization) &&
      unknown.length === 0,
    detail: `requests=[${evm.requests.map((r) => `${r.request_id}/${r.method}`).join(', ')}]`,
  });
  const td = batch[0]?.typed_data;
  if (!td) return checks;

  let digest = '';
  try {
    const w = typedDataForWallet(td);
    digest = hashTypedData(w as Parameters<typeof hashTypedData>[0]);
  } catch (e) {
    digest = `（算不出：${String(e)}）`;
  }
  checks.push({
    id: 'evm-digest',
    ok: digest.toLowerCase() === evm.execution_digest.toLowerCase(),
    detail: `hashTypedData=${digest}，execution_digest=${evm.execution_digest}`,
  });

  const d = td.domain;
  const m = td.message as {batchedCall?: {calls?: Call[]; revertOnFailure?: boolean}; nonce?: string; executor?: string; deadline?: string};
  const saltWant = '0x' + CALIBUR_IMPLEMENTATION.slice(2).padStart(64, '0');
  const domainOk =
    td.primary_type === 'SignedBatchedCall' &&
    d.name === 'Calibur' &&
    d.version === '1.0.0' &&
    Number(d.chainId) === chainId &&
    sameAddress(String(d.verifyingContract), evm.signer_address) &&
    String(d.salt).toLowerCase() === saltWant;
  checks.push({
    id: 'evm-domain',
    ok: domainOk,
    detail: `primaryType=${td.primary_type} name=${d.name} version=${d.version} chainId=${d.chainId}(期望 ${chainId}) verifyingContract=${d.verifyingContract} salt=${d.salt}`,
  });

  const deadlineSec = Math.floor(Date.parse(evm.deadline) / 1000);
  const envOk =
    sameAddress(m.executor, MULTICALL3) && String(m.nonce) === evm.nonce && String(m.deadline) === String(deadlineSec);
  checks.push({
    id: 'evm-envelope',
    ok: envOk,
    detail: `executor=${m.executor} nonce=${m.nonce}(期望 ${evm.nonce}) deadline=${m.deadline}(期望 ${deadlineSec})`,
  });

  checks.push(callsBoundary(m.batchedCall?.calls ?? [], intent));

  for (const a of auths) {
    const auth = a.authorization!;
    checks.push({
      id: 'evm-7702-auth',
      ok: sameAddress(auth.address, CALIBUR_IMPLEMENTATION) && Number(auth.chain_id) === chainId,
      detail: `委托目标=${auth.address}(期望 Calibur 实现合约) chain_id=${auth.chain_id} nonce=${auth.nonce}`,
    });
  }
  return checks;
}

/** 批次边界（fastswap.md §5）：≤2 条；approve 只许打在投入币上且额度合规；不许 transfer。 */
export function callsBoundary(calls: Call[], intent: CreateIntent): Check {
  const fail = (detail: string): Check => ({id: 'evm-calls', ok: false, detail});
  if (calls.length === 0 || calls.length > 2) return fail(`批次有 ${calls.length} 条调用，只许 1–2 条`);
  const asset = normalizeAddress(intent.origin_asset);
  const native = NATIVE_EVM.includes(asset);
  let amountIn: bigint;
  try {
    amountIn = BigInt(intent.amount_in_raw);
  } catch {
    return fail(`amount_in_raw 不是整数：${intent.amount_in_raw}`);
  }
  for (const [i, c] of calls.entries()) {
    const sel = c.data.slice(0, 10).toLowerCase();
    if (sel === SEL_TRANSFER || sel === SEL_TRANSFER_FROM) return fail(`第 ${i} 条是 transfer/transferFrom`);
  }
  const first = calls[0]!;
  const hasApprove = first.data.toLowerCase().startsWith(SEL_APPROVE);
  if (hasApprove) {
    if (native) return fail('投入是原生币，批次里却有 approve');
    if (normalizeAddress(first.to) !== asset) return fail(`approve 打在 ${first.to}，投入币是 ${intent.origin_asset}`);
    if (BigInt(first.value) !== 0n) return fail('approve 带了原生币 value');
    const body = first.data.slice(10);
    const spender = '0x' + body.slice(24, 64).toLowerCase();
    const amount = BigInt('0x' + (body.slice(64, 128) || '0'));
    if (!(amount === amountIn || (spender === PERMIT2 && amount === MAX_UINT256))) {
      return fail(`approve 额度 ${amount} 与投入额 ${amountIn} 不符（spender=${spender}）`);
    }
  }
  for (const [i, c] of calls.entries()) {
    if (i === 0 && hasApprove) continue;
    if (!native && normalizeAddress(c.to) === asset) return fail(`第 ${i} 条调用打在投入币上且不是那条合规 approve`);
  }
  const spend = calls[calls.length - 1]!;
  const spendValue = BigInt(spend.value);
  if (native ? spendValue !== amountIn : spendValue !== 0n) {
    return fail(`花钱那条 value=${spendValue}，投入${native ? '是原生币，应恰好等于投入额' : '是 ERC-20，不得带 value'}`);
  }
  return {
    id: 'evm-calls',
    ok: true,
    detail: `${calls.length} 条调用${hasApprove ? '（approve + 花钱）' : ''}，边界合规`,
  };
}

/** 签后：批次签名恢复出签名者；7702 授权签名同样恢复出签名者。 */
export async function evmPostSign(
  evm: EvmSigning,
  signatures: {request_id: string; signature: string}[],
): Promise<Check[]> {
  const checks: Check[] = [];
  for (const s of signatures) {
    let digest: Hex;
    if (s.request_id === 'calibur_batch') {
      digest = evm.execution_digest as Hex;
    } else {
      const a = evm.requests.find((r) => r.request_id === s.request_id)?.authorization;
      if (!a) {
        checks.push({id: `evm-recover-${s.request_id}`, ok: false, detail: '没有对应的签名请求'});
        continue;
      }
      digest = hash7702Authorization({chainId: Number(a.chain_id), address: a.address, nonce: Number(a.nonce)});
    }
    const who = await recoverOrNote(digest, s.signature);
    const ok = sameAddress(who, evm.signer_address);
    checks.push({
      id: `evm-recover-${s.request_id}`,
      ok,
      // 不过时把**怎么排查**写进 detail：恢复出一个陌生地址有三种成因，
      // 症状一模一样而处置完全不同（见 recoveryHint）。
      detail:
        `ecrecover=${who}，期望 ${evm.signer_address}` +
        (ok ? '' : await recoveryHint(digest, s.signature, evm.signer_address, batchTd(evm, s.request_id))),
    });
  }
  const want = evm.requests.map((r) => r.request_id).sort().join(',');
  const got = signatures.map((s) => s.request_id).sort().join(',');
  checks.push({id: 'evm-all-signed', ok: want === got, detail: `要签 [${want}]，签了 [${got}]`});
  return checks;
}

/** 这一项对应的 typed data（只有 typed-data 那种请求有）。 */
function batchTd(evm: EvmSigning, requestID: string): ServerTypedData | undefined {
  return evm.requests.find((r) => r.request_id === requestID)?.typed_data ?? undefined;
}

async function recoverOrNote(digest: Hex, signature: string): Promise<string> {
  try {
    return normalizeAddress(await recoverAddress({hash: digest, signature: signature as Hex}));
  } catch (e) {
    return `（恢复失败：${String(e)}）`;
  }
}

/**
 * 恢复出陌生地址时的排查线索。三种成因症状一样，处置完全不同：
 *
 *   ① **recovery id（v）反了** —— 换另一个 parity 能恢复出正确的签名者。
 *      钥匙是对的，错在拼装签名的那一层。注意 27/28 与 0/1 两套写法 viem
 *      **都认**，所以"27 写成 0"不会表现成这个症状，只有 parity 真的反了才会。
 *   ② **签名长度不是 65 字节** —— 拿到的多半不是 ECDSA 签名（智能账户的
 *      ERC-1271 签名，或者钱包把别的东西返回了）。
 *   ③ 长度对、两个 parity 都不是期望地址 —— **钱包用了另一把钥匙签**。
 *      这一条最危险：提交上去会在链上恢复出陌生地址，整笔被拒。
 */
async function recoveryHint(digest: Hex, signature: string, want: string, td?: ServerTypedData): Promise<string> {
  const hex = signature.replace(/^0x/, '');
  if (hex.length !== 130) return ` · 签名是 ${hex.length / 2} 字节，不是 65 —— 这多半不是一个 ECDSA 签名`;
  // 先问"它到底签的是哪一份"：钥匙对不对与摘要对不对，症状一样、处置相反。
  for (const [label, hash] of candidateDigests(td)) {
    if (sameAddress(await recoverOrNote(hash, signature), want)) {
      return ` · 签名本身是好的，但它签的是**${label}**（${hash}），不是服务端那份摘要 —— 钥匙没错，错在交给钱包的那份 typed data`;
    }
  }
  const v = parseInt(hex.slice(128), 16);
  const other = v === 27 || v === 28 ? (v === 27 ? 28 : 27) : v === 0 || v === 1 ? v ^ 1 : NaN;
  if (Number.isNaN(other)) return ` · v=${v}，既不是 27/28 也不是 0/1`;
  const alt = await recoverOrNote(digest, `0x${hex.slice(0, 128)}${other.toString(16).padStart(2, '0')}`);
  if (sameAddress(alt, want)) return ` · v=${v}，换成 ${other} 恢复出的正是期望地址 —— 是签名的 recovery id 反了，不是钥匙错了`;
  return ` · v=${v}，两个 parity 都不是期望地址 —— 钱包用了另一把钥匙签（提交上去会在链上恢复出陌生地址）`;
}

/**
 * 「它到底签了什么」的候选摘要表。每一条都对应一种真实踩过 / 可能踩的错法：
 * 域类型按键序声明、只签了结构体哈希或域分隔符、以及把 typed data 当普通消息签。
 */
function candidateDigests(td?: ServerTypedData): [string, Hex][] {
  if (!td) return [];
  const out: [string, Hex][] = [];
  const push = (label: string, f: () => Hex) => {
    try {
      out.push([label, f()]);
    } catch {
      /* 算不出来的候选就是一条线索没了，不该把核对本身弄挂 */
    }
  };
  const order: Record<string, string> = {
    name: 'string',
    version: 'string',
    chainId: 'uint256',
    verifyingContract: 'address',
    salt: 'bytes32',
  };
  const {EIP712Domain: _drop, ...types} = td.types;
  push('域类型按 JSON 键序（字母序）声明的那一份', () =>
    hashTypedData({
      domain: td.domain,
      types: {...types, EIP712Domain: Object.keys(td.domain).map((k) => ({name: k, type: order[k] ?? 'string'}))},
      primaryType: td.primary_type,
      message: td.message,
    } as Parameters<typeof hashTypedData>[0]),
  );
  push('把 typed data 当普通消息签（EIP-191）', () => hashMessage(JSON.stringify(typedDataToSign(td))));
  return out;
}

/** 7702 签名结果 → 65 字节 r‖s‖v 的 0x hex（v 取 27/28）。 */
export function authSignatureHex(r: string, s: string, yParity: number): string {
  const pad = (h: string) => h.replace(/^0x/, '').padStart(64, '0');
  return `0x${pad(r)}${pad(s)}${(27 + yParity).toString(16)}`;
}
