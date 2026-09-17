import {describe, expect, it} from 'vitest';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {encodeFunctionData, erc20Abi, hashTypedData, type Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';

import {toBase64} from '../signature';
import {
  CALIBUR_IMPLEMENTATION,
  MULTICALL3,
  PERMIT2,
  acceptedMinOut,
  authSignatureHex,
  callsBoundary,
  evmPostSign,
  evmPreSign,
  failed,
  preSignChecks,
  solanaPostSign,
  solanaPreSign,
  typedDataForWallet,
  typedDataToSign,
} from './verify';
import type {CreateIntent, EvmSigning, SolanaSigning, SwapSnapshot} from './wire';
import golden from './testdata/evm-calibur-typeddata.json';

// ---------------------------------------------------------------------------
// Solana
// ---------------------------------------------------------------------------

const BLOCKHASH = '11111111111111111111111111111111';

async function sha256Hex(b: Uint8Array) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', b as BufferSource)).toString('hex');
}

/** 一笔「代付方已签、用户那一槽空着」的赞助交易，形状与服务端交来的一致。 */
async function sponsoredTx() {
  const feePayer = Keypair.generate();
  const user = Keypair.generate();
  const msg = new TransactionMessage({
    payerKey: feePayer.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [SystemProgram.transfer({fromPubkey: user.publicKey, toPubkey: feePayer.publicKey, lamports: 1})],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([feePayer]);
  const sign: SolanaSigning = {
    kind: 1,
    transaction_base64: toBase64(tx.serialize()),
    message_hash: await sha256Hex(msg.serialize()),
    fee_payer_address: feePayer.publicKey.toBase58(),
    user_signer_address: user.publicKey.toBase58(),
    blockhash: BLOCKHASH,
    last_valid_block_height: '100',
    lookup_tables: [],
    broadcast: {mode: 1, endpoint_id: 'gateway', backup_endpoint_id: null},
  };
  return {feePayer, user, sign};
}

describe('solanaPreSign', () => {
  it('服务端交来的赞助交易全部核对通过', async () => {
    const {sign} = await sponsoredTx();
    const {checks, decoded} = await solanaPreSign(sign);
    expect(failed(checks)).toEqual([]);
    expect(decoded?.userIndex).toBe(1);
  });

  it('message_hash 对不上时拦下', async () => {
    const {sign} = await sponsoredTx();
    const {checks} = await solanaPreSign({...sign, message_hash: '00'.repeat(32)});
    expect(failed(checks).map((c) => c.id)).toEqual(['sol-message-hash']);
  });

  it('代付方那一槽是空的（平台没预签）时拦下', async () => {
    const {sign} = await sponsoredTx();
    const tx = VersionedTransaction.deserialize(Buffer.from(sign.transaction_base64, 'base64'));
    tx.signatures[0] = new Uint8Array(64);
    const {checks} = await solanaPreSign({...sign, transaction_base64: toBase64(tx.serialize())});
    expect(failed(checks).map((c) => c.id)).toContain('sol-platform-presign');
  });

  it('用户地址不是签名者时拦下', async () => {
    const {sign} = await sponsoredTx();
    const {checks} = await solanaPreSign({...sign, user_signer_address: Keypair.generate().publicKey.toBase58()});
    expect(failed(checks).map((c) => c.id)).toContain('sol-user-signer');
  });

  it('引用了没给出的地址查找表时拦下', async () => {
    const {sign} = await sponsoredTx();
    const tx = VersionedTransaction.deserialize(Buffer.from(sign.transaction_base64, 'base64'));
    tx.message.addressTableLookups.push({accountKey: new PublicKey(BLOCKHASH), writableIndexes: [0], readonlyIndexes: []});
    const {checks} = await solanaPreSign({
      ...sign,
      transaction_base64: toBase64(tx.serialize()),
      message_hash: await sha256Hex(tx.message.serialize()),
    });
    expect(failed(checks).map((c) => c.id)).toContain('sol-lookup-tables');
  });
});

describe('solanaPostSign', () => {
  it('用户正常签名：message 不变、平台签名保留、用户签名有效', async () => {
    const {user, sign} = await sponsoredTx();
    const {decoded} = await solanaPreSign(sign);
    const tx = VersionedTransaction.deserialize(Buffer.from(sign.transaction_base64, 'base64'));
    tx.sign([user]);
    const {checks, signedBase64} = await solanaPostSign(decoded!, tx.serialize());
    expect(failed(checks)).toEqual([]);
    expect(signedBase64).toBe(toBase64(tx.serialize()));
  });

  it('钱包覆盖了平台签名时拒绝上报', async () => {
    const {user, sign} = await sponsoredTx();
    const {decoded} = await solanaPreSign(sign);
    const tx = VersionedTransaction.deserialize(Buffer.from(sign.transaction_base64, 'base64'));
    tx.sign([user]);
    tx.signatures[0] = new Uint8Array(64).fill(7);
    const {checks, signedBase64} = await solanaPostSign(decoded!, tx.serialize());
    expect(failed(checks).map((c) => c.id)).toEqual(['sol-platform-kept']);
    expect(signedBase64).toBeNull();
  });

  it('钱包改了 message（比如换 blockhash）时拒绝上报', async () => {
    const {user, feePayer, sign} = await sponsoredTx();
    const {decoded} = await solanaPreSign(sign);
    const other = new TransactionMessage({
      payerKey: feePayer.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [SystemProgram.transfer({fromPubkey: user.publicKey, toPubkey: feePayer.publicKey, lamports: 1})],
    }).compileToV0Message();
    const tx = new VersionedTransaction(other);
    tx.sign([feePayer, user]);
    const {checks} = await solanaPostSign(decoded!, tx.serialize());
    expect(failed(checks).map((c) => c.id)).toContain('sol-message-unchanged');
  });

  it('用户那一槽没签时拒绝上报', async () => {
    const {sign} = await sponsoredTx();
    const {decoded} = await solanaPreSign(sign);
    const {checks} = await solanaPostSign(decoded!, Buffer.from(sign.transaction_base64, 'base64'));
    expect(failed(checks).map((c) => c.id)).toEqual(['sol-user-signature']);
  });
});

// ---------------------------------------------------------------------------
// EVM / Calibur
// ---------------------------------------------------------------------------

const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const TOKEN = '0x3efbfff95576e1d23cf6ead0acd2e73f4d6a7777';
const ROUTER = '0xccc88a9d1b4ed6b0eaba998850414b24f1c315be';

function evmIntent(over: Partial<CreateIntent> = {}): CreateIntent {
  return {
    client_intent_id: 'cid',
    origin_chain: 'eip155:56',
    destination_chain: 'solana:mainnet',
    origin_asset: TOKEN,
    destination_asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    amount_in_raw: '1000',
    slippage_bps: 300,
    side: 2,
    source_wallet_id: 'w-evm',
    destination_wallet_id: 'w-sol',
    fee_policy: 1,
    ...over,
  };
}

function approve(spender: string, amount: bigint) {
  return encodeFunctionData({abi: erc20Abi, functionName: 'approve', args: [spender as Hex, amount]});
}

/** 按后端 typedDataJSON 的形状造一份 Calibur 批次（带 EIP712Domain，与线上一致）。 */
function caliburSigning(calls: {to: string; value: string; data: string}[], withAuth = true): EvmSigning {
  const deadline = '2026-09-17T12:00:00Z';
  const typed = {
    domain: {
      name: 'Calibur',
      version: '1.0.0',
      chainId: 56,
      verifyingContract: account.address,
      salt: '0x' + CALIBUR_IMPLEMENTATION.slice(2).padStart(64, '0'),
    },
    types: golden.types,
    primary_type: 'SignedBatchedCall',
    message: {
      batchedCall: {calls, revertOnFailure: true},
      nonce: '123456789',
      keyHash: '0x' + '00'.repeat(32),
      executor: MULTICALL3,
      deadline: String(Date.parse(deadline) / 1000),
    },
  };
  const digest = hashTypedData(typedDataForWallet(typed) as Parameters<typeof hashTypedData>[0]);
  return {
    kind: 2,
    chain: 'eip155:56',
    signer_address: account.address,
    execution_digest: digest,
    nonce: '123456789',
    deadline,
    requests: [
      {request_id: 'calibur_batch', method: 1, typed_data: typed, authorization: null},
      ...(withAuth
        ? [
            {
              request_id: 'authorization_7702',
              method: 2,
              typed_data: null,
              authorization: {chain_id: '56', address: CALIBUR_IMPLEMENTATION, nonce: '7'},
            },
          ]
        : []),
    ],
  };
}

const GOLDEN_DIGEST = '0x82f0d74b9881c127d15c937b836e9ab87e938c4a9d0c1612da23276d5d667390';

describe('typedDataForWallet', () => {
  it('与后端 golden 文件算出同一枚摘要（Go 侧 apitypes.TypedDataAndHash 实测值）', () => {
    const td = {...golden, primary_type: golden.primaryType};
    expect(hashTypedData(typedDataForWallet(td) as Parameters<typeof hashTypedData>[0])).toBe(GOLDEN_DIGEST);
  });
});

describe('evmPreSign', () => {
  const good = [
    {to: TOKEN, value: '0', data: approve(ROUTER, 1000n)},
    {to: ROUTER, value: '0', data: '0xf9e4bab4deadbeef'},
  ];

  it('合规批次（approve 恰好投入额 + 花钱）全部通过', () => {
    expect(failed(evmPreSign(caliburSigning(good), evmIntent(), account.address))).toEqual([]);
  });

  it('execution_digest 被换掉时拦下', () => {
    const s = {...caliburSigning(good), execution_digest: '0x' + 'ab'.repeat(32)};
    expect(failed(evmPreSign(s, evmIntent(), account.address)).map((c) => c.id)).toEqual(['evm-digest']);
  });

  it('签名者不是本页的钱包时拦下', () => {
    const other = privateKeyToAccount(`0x${'22'.repeat(32)}`).address;
    expect(failed(evmPreSign(caliburSigning(good), evmIntent(), other)).map((c) => c.id)).toContain('evm-signer');
  });

  it('7702 委托目标不是 Calibur 实现合约时拦下', () => {
    const s = caliburSigning(good);
    s.requests[1]!.authorization!.address = ROUTER;
    expect(failed(evmPreSign(s, evmIntent(), account.address)).map((c) => c.id)).toEqual(['evm-7702-auth']);
  });

  it('多出一条未知签名请求时拦下', () => {
    const s = caliburSigning(good);
    s.requests.push({request_id: 'extra', method: 1, typed_data: null, authorization: null});
    expect(failed(evmPreSign(s, evmIntent(), account.address)).map((c) => c.id)).toContain('evm-requests');
  });
});

describe('callsBoundary', () => {
  it('授权给 Permit2 的无限额度是既定形态，放行', () => {
    const calls = [
      {to: TOKEN, value: '0', data: approve(PERMIT2, (1n << 256n) - 1n)},
      {to: ROUTER, value: '0', data: '0x12345678'},
    ];
    expect(callsBoundary(calls, evmIntent()).ok).toBe(true);
  });

  it('给路由器无限额度（不是 Permit2）拒绝', () => {
    const calls = [
      {to: TOKEN, value: '0', data: approve(ROUTER, (1n << 256n) - 1n)},
      {to: ROUTER, value: '0', data: '0x12345678'},
    ];
    expect(callsBoundary(calls, evmIntent()).ok).toBe(false);
  });

  it('approve 打在别的代币上拒绝', () => {
    const calls = [
      {to: ROUTER, value: '0', data: approve(ROUTER, 1000n)},
      {to: ROUTER, value: '0', data: '0x12345678'},
    ];
    expect(callsBoundary(calls, evmIntent()).ok).toBe(false);
  });

  it('任何一条 transfer 都拒绝', () => {
    const data = encodeFunctionData({abi: erc20Abi, functionName: 'transfer', args: [ROUTER, 1n]});
    expect(callsBoundary([{to: ROUTER, value: '0', data}], evmIntent()).ok).toBe(false);
  });

  it('三条调用拒绝', () => {
    const c = {to: ROUTER, value: '0', data: '0x12345678'};
    expect(callsBoundary([c, c, c], evmIntent()).ok).toBe(false);
  });

  it('ERC-20 投入时花钱那条带 value 拒绝；原生币投入时 value 必须恰好等于投入额', () => {
    expect(callsBoundary([{to: ROUTER, value: '1', data: '0x12345678'}], evmIntent()).ok).toBe(false);
    const native = evmIntent({origin_asset: '0x0000000000000000000000000000000000000000'});
    expect(callsBoundary([{to: ROUTER, value: '1000', data: '0x12345678'}], native).ok).toBe(true);
    expect(callsBoundary([{to: ROUTER, value: '999', data: '0x12345678'}], native).ok).toBe(false);
  });
});

describe('交给钱包的那份 typed data', () => {
  // 服务端的 domain 是 protobuf Struct 编出来的，**键是字母序**。谁要是按键序
  // 去声明域类型，domainSeparator 与规范序完全不同 —— 签名合法、ecrecover 出
  // 一个陌生地址（2026-09-18 的 0x9324fb48…）。带上 EIP712Domain 就没有推断这一步。
  it('原样带 EIP712Domain 与摘掉它算出的摘要相同（规范序）', () => {
    const td = {...golden, primary_type: golden.primaryType} as unknown as Parameters<typeof typedDataToSign>[0];
    const withDomain = hashTypedData(typedDataToSign(td) as Parameters<typeof hashTypedData>[0]);
    const without = hashTypedData(typedDataForWallet(td) as Parameters<typeof hashTypedData>[0]);
    expect(withDomain).toBe(without);
    expect(withDomain).toBe(GOLDEN_DIGEST);
  });

  it('按字母序声明域类型会算出另一个摘要 —— 这就是那条坑', () => {
    const order: Record<string, string> = {
      name: 'string',
      version: 'string',
      chainId: 'uint256',
      verifyingContract: 'address',
      salt: 'bytes32',
    };
    const td = {...golden, primary_type: golden.primaryType} as unknown as {domain: Record<string, unknown>; types: Record<string, Record<string, unknown>[]>; primary_type: string; message: Record<string, unknown>};
    const {EIP712Domain: _drop, ...types} = td.types;
    const alpha = hashTypedData({
      domain: td.domain,
      types: {...types, EIP712Domain: Object.keys(td.domain).map((k) => ({name: k, type: order[k]}))},
      primaryType: td.primary_type,
      message: td.message,
    } as Parameters<typeof hashTypedData>[0]);
    expect(alpha).not.toBe(GOLDEN_DIGEST);
  });
});

describe('evmPostSign', () => {
  it('批次签名与 7702 授权签名都恢复出签名者', async () => {
    const s = caliburSigning([{to: ROUTER, value: '0', data: '0x12345678'}]);
    const batchSig = await account.sign({hash: s.execution_digest as Hex});
    const auth = await account.signAuthorization({chainId: 56, contractAddress: CALIBUR_IMPLEMENTATION as Hex, nonce: 7});
    const checks = await evmPostSign(s, [
      {request_id: 'calibur_batch', signature: batchSig},
      {request_id: 'authorization_7702', signature: authSignatureHex(auth.r, auth.s, auth.yParity!)},
    ]);
    expect(failed(checks)).toEqual([]);
  });

  it('recovery id 反了时，detail 指出是 recovery id 的错，不是钥匙的错', async () => {
    const s = caliburSigning([{to: ROUTER, value: '0', data: '0x12345678'}]);
    const good = await account.sign({hash: s.execution_digest as Hex});
    // 27 ↔ 28：钥匙没换，只把 parity 反过来。（27 写成 0 不算 —— 两套写法 viem 都认。）
    const v = parseInt(good.slice(-2), 16);
    const bad = `${good.slice(0, -2)}${(v === 27 ? 28 : 27).toString(16)}`;
    const checks = await evmPostSign(s, [{request_id: 'calibur_batch', signature: bad}]);
    const row = checks.find((c) => c.id === 'evm-recover-calibur_batch')!;
    expect(row.ok).toBe(false);
    expect(row.detail).toContain('recovery id 反了');
  });

  it('27/28 与 0/1 两套写法都认：只换写法不会被判成签名不对', async () => {
    const s = caliburSigning([{to: ROUTER, value: '0', data: '0x12345678'}]);
    const good = await account.sign({hash: s.execution_digest as Hex});
    const v = parseInt(good.slice(-2), 16);
    const same = `${good.slice(0, -2)}0${(v - 27).toString(16)}`;
    const checks = await evmPostSign(s, [{request_id: 'calibur_batch', signature: same}]);
    expect(checks.find((c) => c.id === 'evm-recover-calibur_batch')!.ok).toBe(true);
  });

  it('长度不是 65 字节时直接点出来', async () => {
    const s = caliburSigning([{to: ROUTER, value: '0', data: '0x12345678'}]);
    const checks = await evmPostSign(s, [{request_id: 'calibur_batch', signature: `0x${'ab'.repeat(64)}`}]);
    const row = checks.find((c) => c.id === 'evm-recover-calibur_batch')!;
    expect(row.ok).toBe(false);
    expect(row.detail).toContain('不是 65');
  });

  it('换一把钥匙签的：detail 说钥匙不对，而不是让人去翻 v', async () => {
    const s = caliburSigning([{to: ROUTER, value: '0', data: '0x12345678'}]);
    const other = privateKeyToAccount(`0x${'33'.repeat(32)}`);
    const sig = await other.sign({hash: s.execution_digest as Hex});
    const checks = await evmPostSign(s, [{request_id: 'calibur_batch', signature: sig}]);
    const row = checks.find((c) => c.id === 'evm-recover-calibur_batch')!;
    expect(row.ok).toBe(false);
    expect(row.detail).toContain('钱包用了另一把钥匙签');
  });

  it('签的是别的摘要时拦下；漏签一项时拦下', async () => {
    const s = caliburSigning([{to: ROUTER, value: '0', data: '0x12345678'}]);
    const wrong = await account.sign({hash: `0x${'cd'.repeat(32)}`});
    const checks = await evmPostSign(s, [{request_id: 'calibur_batch', signature: wrong}]);
    expect(failed(checks).map((c) => c.id)).toEqual(['evm-recover-calibur_batch', 'evm-all-signed']);
  });
});

// ---------------------------------------------------------------------------
// §4 七条
// ---------------------------------------------------------------------------

function readySnapshot(intent: CreateIntent, sign: EvmSigning): SwapSnapshot {
  return {
    swap_id: 'sw1',
    execution_group_id: 'eg1',
    event_version: '3',
    intent,
    intent_hash: 'ih',
    preparation: {status: 2, current_revision: '1', retry_after_ms: 20_000, reason_code: null},
    revision: {
      revision: '1',
      intent_hash: 'ih',
      created_at: '',
      quote_valid_until: '',
      safe_sign_before: '',
      safe_broadcast_before: '',
      assets: {origin: {chain: '', address: '', decimals: 18}, destination: {chain: '', address: '', decimals: 6}},
      expected_out_raw: '1000',
      min_out_raw: '970',
      fees: [],
      relay_request_id: '',
      solana: null,
      evm: sign,
    },
  } as unknown as SwapSnapshot;
}

describe('acceptedMinOut', () => {
  it('报价底价再让一个滑点带、向下取整；82a2caac 那一笔的建单底价落在线内', () => {
    expect(acceptedMinOut('1000000', 300)).toBe('970000');
    expect(acceptedMinOut('999', 300)).toBe('969'); // 969.03 → 969
    // 实测：建单底价 1937478。报价底价只要不高于 1997400（=建单预计到手），让 3% 后都 ≤ 1937478
    expect(BigInt(acceptedMinOut('1997400', 300)) <= 1937478n).toBe(true);
  });
});

describe('preSignChecks', () => {
  const intent = evmIntent();
  const sign = caliburSigning([{to: ROUTER, value: '0', data: '0x12345678'}]);
  const base = {
    intent,
    walletAddress: account.address,
    receivedAt: 1000,
    now: 2000,
    visible: true,
    hasUnreportedArtifact: false,
    acceptedMinOutRaw: '960',
  };

  it('一切正常时七条全过', () => {
    expect(failed(preSignChecks({...base, snapshot: readySnapshot(intent, sign)}))).toEqual([]);
  });

  it('逐条触发：revision 不是当前版、intent_hash 不一致、过期、后台、已有产物、底价变差', () => {
    const snap = readySnapshot(intent, sign);
    snap.preparation.current_revision = '2';
    snap.revision.intent_hash = 'other';
    snap.revision.min_out_raw = '900';
    const ids = failed(
      preSignChecks({...base, snapshot: snap, now: 30_000, visible: false, hasUnreportedArtifact: true}),
    ).map((c) => c.id);
    expect(ids).toEqual([
      '2-ready-revision',
      '3-intent-hash',
      '5-deadline-foreground',
      '6-no-pending-artifact',
      '7-min-out',
    ]);
  });

  it('EVM 资产地址的大小写不算不一致 —— 服务端在建单入口归一成小写', () => {
    // EIP-55 的大小写是校验和，不是身份。用户从代币列表里拷一个校验和写法的
    // 地址进来（0203c74b 那一笔），逐字节比的版本会在签前第 1 条拦下同一个币。
    const mine = evmIntent({origin_asset: TOKEN.toUpperCase().replace('0X', '0x')});
    const snap = readySnapshot(evmIntent({origin_asset: TOKEN.toLowerCase()}), sign);
    expect(failed(preSignChecks({...base, intent: mine, snapshot: snap}))).toEqual([]);
  });

  it('Solana mint 的大小写仍逐字节比 —— base58 改一个字母就是另一个币', () => {
    const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const snap = readySnapshot(evmIntent({destination_asset: mint.toLowerCase()}), sign);
    expect(failed(preSignChecks({...base, snapshot: snap})).map((c) => c.id)).toEqual(['1-intent-wallet']);
  });

  it('服务端的 intent 与本地确认的不一致（金额被改）时拦下', () => {
    const snap = readySnapshot({...intent, amount_in_raw: '9999'}, sign);
    expect(failed(preSignChecks({...base, snapshot: snap})).map((c) => c.id)).toEqual(['1-intent-wallet']);
  });

  it('两份材料同时在场时拦下', () => {
    const snap = readySnapshot(intent, sign);
    snap.revision.solana = {kind: 1} as SolanaSigning;
    expect(failed(preSignChecks({...base, snapshot: snap})).map((c) => c.id)).toContain('4-one-material');
  });
});
