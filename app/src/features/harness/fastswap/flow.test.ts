import {beforeEach, describe, expect, it, vi} from 'vitest';
import {Keypair, SystemProgram, TransactionMessage, VersionedTransaction} from '@solana/web3.js';

import {toBase64} from '../signature';
import {SwapApiError, type SwapClient} from './client';
import {NO_FAULTS, SwapRun, type Faults, type FlowDeps, type RunState} from './flow';
import {createSwapStore, withSwapLock} from './store';
import type {CreateIntent, EventsReply, ExecutionReport, SwapSnapshot} from './wire';

// ---------------------------------------------------------------------------
// 假件：一笔 Solana 赞助交易 + 一个按调用次数推进的假后端
// ---------------------------------------------------------------------------

const feePayer = Keypair.generate();
const user = Keypair.generate();

async function sponsoredSigning() {
  const msg = new TransactionMessage({
    payerKey: feePayer.publicKey,
    recentBlockhash: '11111111111111111111111111111111',
    instructions: [SystemProgram.transfer({fromPubkey: user.publicKey, toPubkey: feePayer.publicKey, lamports: 1})],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([feePayer]);
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', msg.serialize() as BufferSource)).toString('hex');
  return {
    kind: 1,
    transaction_base64: toBase64(tx.serialize()),
    message_hash: hash,
    fee_payer_address: feePayer.publicKey.toBase58(),
    user_signer_address: user.publicKey.toBase58(),
    blockhash: '11111111111111111111111111111111',
    last_valid_block_height: '1',
    lookup_tables: [],
    broadcast: {mode: 1, endpoint_id: 'gw', backup_endpoint_id: null},
  };
}

const INTENT: Omit<CreateIntent, 'client_intent_id'> = {
  origin_chain: 'solana:mainnet',
  destination_chain: 'solana:mainnet',
  origin_asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  destination_asset: 'So11111111111111111111111111111111111111112',
  amount_in_raw: '1000000',
  slippage_bps: 300,
  side: 1,
  source_wallet_id: 'w-sol',
  destination_wallet_id: 'w-sol',
  fee_policy: 1,
};

let signing: Awaited<ReturnType<typeof sponsoredSigning>>;
beforeEach(async () => {
  signing = await sponsoredSigning();
});

function snap(intent: CreateIntent, over: {prep?: Partial<SwapSnapshot['preparation']>; exec?: number; outcome?: number; version?: string} = {}): SwapSnapshot {
  return {
    swap_id: 'sw1',
    execution_group_id: 'eg1',
    event_version: over.version ?? '1',
    intent,
    intent_hash: 'ih',
    preparation: {status: 2, current_revision: '1', retry_after_ms: 30_000, reason_code: null, ...over.prep},
    revision: {
      revision: over.prep?.current_revision ?? '1',
      intent_hash: 'ih',
      created_at: '',
      quote_valid_until: '',
      safe_sign_before: '',
      safe_broadcast_before: '',
      assets: {origin: {chain: '', address: '', decimals: 6}, destination: {chain: '', address: '', decimals: 9}},
      expected_out_raw: '100',
      min_out_raw: '97',
      fees: [],
      relay_request_id: '',
      solana: signing,
      evm: null,
    },
    execution: {status: over.exec ?? 1, artifact_hash: null, origin_tx_hash: null, relay_request_id: null, relay_execution_id: null, user_operation_hash: null, failure_cause: null, recovery_action: null},
    settlement: {
      source: 1, destination: 1, relay: 1, accounting: 1, outcome: over.outcome ?? 1,
      amount_in_actual_raw: null, amount_out_actual_raw: null, amount_refunded_raw: null,
      destination_tx_hash: null, destination_observed_at: null, destination_finalized_at: null, refund_fee_delta_raw: null,
    },
    fast_fill: {status: 1, reason_code: null},
    availability: {asset: '', chain: '', wallet_id: '', balance_raw: null, reserved_raw: null, spendable_raw: null, can_execute: false, reason_code: null, observed_block: null, observed_at: null},
  };
}

const terminal = (s: SwapSnapshot): EventsReply => ({
  contract_version: 'fast-swap.v1',
  items: [{swap_id: 'sw1', event_version: '9', type: 3, occurred_at: '', trace_id: '', snapshot: {...s, event_version: '9', execution: {...s.execution, status: 3}, settlement: {...s.settlement, source: 3, destination: 3, relay: 2, accounting: 2, outcome: 2, amount_out_actual_raw: '99'}}}],
  next_version: '9',
  reset_required: false,
  poll_after_ms: null,
});

function bizError(code: number, recovery: string, extra: Record<string, string> = {}) {
  return new SwapApiError('business', code, 'x', {meta: {recovery_action: recovery, ...extra}});
}

type Calls = {create: [CreateIntent, string][]; execute: [ExecutionReport, string][]; refresh: number; get: number; events: string[]};

function fakeClient(script: {
  create?: (i: CreateIntent, n: number) => SwapSnapshot | Error;
  execute?: (n: number) => SwapSnapshot | Error;
  refresh?: (n: number) => SwapSnapshot;
  get?: (n: number) => SwapSnapshot;
  events?: (after: string, n: number) => EventsReply;
}) {
  const calls: Calls = {create: [], execute: [], refresh: 0, get: 0, events: []};
  let last: SwapSnapshot | null = null;
  const reply = (s: SwapSnapshot | Error) => {
    if (s instanceof Error) throw s;
    last = s;
    return {contract_version: 'fast-swap.v1', swap: s};
  };
  const client = {
    create: vi.fn(async (i: CreateIntent, key: string) => {
      calls.create.push([i, key]);
      return reply(script.create ? script.create(i, calls.create.length) : snap(i));
    }),
    execute: vi.fn(async (_id: string, r: ExecutionReport, key: string) => {
      calls.execute.push([r, key]);
      return reply(script.execute ? script.execute(calls.execute.length) : snap(last!.intent, {exec: 3}));
    }),
    refresh: vi.fn(async () => reply(script.refresh!(++calls.refresh))),
    get: vi.fn(async () => {
      const n = ++calls.get;
      return reply(script.get ? script.get(n) : last!);
    }),
    events: vi.fn(async (_id: string, after: string) => {
      calls.events.push(after);
      return script.events ? script.events(after, calls.events.length) : terminal(last!);
    }),
    cancel: vi.fn(),
    quote: vi.fn(),
    capabilities: vi.fn(),
    active: vi.fn(),
    telemetry: vi.fn(async () => ({contract_version: 'fast-swap.v1', accepted_count: 0, rejected_count: 0})),
  };
  return {client: client as unknown as SwapClient & typeof client, calls};
}

const memoryStorage = () => {
  const m = new Map<string, string>();
  return {getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v)};
};

function deps(client: SwapClient, faults: Partial<Faults> = {}, storage = memoryStorage()) {
  const f: Faults = {...NO_FAULTS, ...faults};
  let n = 0;
  let clock = 1000;
  const signed: number[] = [];
  const d: FlowDeps = {
    client,
    store: createSwapStore('test:u1', storage),
    signer: {
      solana: vi.fn(async (bytes: Uint8Array) => {
        signed.push(1);
        const tx = VersionedTransaction.deserialize(bytes);
        tx.sign([user]);
        return tx.serialize();
      }),
      typedData: vi.fn(),
      authorization7702: vi.fn(),
    },
    account: 'test:u1',
    withLock: (name, fn) => withSwapLock(name, fn, null),
    takeFault: (k) => {
      const v = f[k];
      f[k] = false;
      return v;
    },
    now: () => (clock += 10),
    wall: () => '2026-09-17T00:00:00Z',
    sleep: async (ms) => void (clock += ms),
    visible: () => true,
    uuid: () => `uuid-${++n}`,
    onUpdate: () => {},
    telemetry: async () => {},
    walletAddress: user.publicKey.toBase58(),
  };
  return {d, signed, storage};
}

// ---------------------------------------------------------------------------

describe('SwapRun 正常路径', () => {
  it('建单 → 可签 → 核对 → 签名 → 落盘 → 上报 → 轮询到终态 → 清本地记录', async () => {
    const {client, calls} = fakeClient({});
    const {d, signed} = deps(client);
    const run = SwapRun.start(d, INTENT, '97');
    const s: RunState = await run.run();

    expect(s.stage).toBe('done');
    expect(s.snapshot?.settlement.outcome).toBe(2);
    expect(signed).toHaveLength(1);
    expect(calls.create).toHaveLength(1);
    expect(calls.execute).toHaveLength(1);
    expect(calls.execute[0]![0].solana_transaction?.signed_transaction_base64).toBeTruthy();
    expect(calls.events[0]).toBe('1'); // 第一次轮询从快照的 event_version 起
    expect(s.checks.every((c) => c.ok)).toBe(true);
    expect(s.timeline.create_ms).toBeGreaterThan(0);
    expect(d.store.list()).toEqual([]);
  });
});

describe('幂等重发', () => {
  it('建单回包丢失（故障注入）：同一个 intent 与幂等键重发', async () => {
    const {client, calls} = fakeClient({});
    const {d} = deps(client, {dropCreateResponse: true});
    const s = await SwapRun.start(d, INTENT, null).run();
    expect(s.stage).toBe('done');
    expect(calls.create).toHaveLength(2);
    expect(calls.create[0]![1]).toBe(calls.create[1]![1]);
    expect(calls.create[0]![0].client_intent_id).toBe(calls.create[1]![0].client_intent_id);
  });

  it('建单网络失败：同键重发，不换 intent', async () => {
    const {client, calls} = fakeClient({
      create: (i, n) => (n === 1 ? new SwapApiError('network', 0, 'boom') : snap(i)),
    });
    const {d} = deps(client);
    expect((await SwapRun.start(d, INTENT, null).run()).stage).toBe('done');
    expect(new Set(calls.create.map((c) => c[1])).size).toBe(1);
  });

  it('钱包忙 420603：停下并指向那一笔，不换 id 绕过', async () => {
    const {client, calls} = fakeClient({create: () => bizError(420603, 'get_snapshot', {related_swap_id: 'sw-old'})});
    const {d} = deps(client);
    const s = await SwapRun.start(d, INTENT, null).run();
    expect(s.stage).toBe('stopped');
    expect(s.stopReason).toContain('sw-old');
    expect(calls.create).toHaveLength(1);
  });

  it('上报回包丢失（故障注入）：原幂等键重发，只签一次', async () => {
    const {client, calls} = fakeClient({});
    const {d, signed} = deps(client, {dropExecutionResponse: true});
    expect((await SwapRun.start(d, INTENT, null).run()).stage).toBe('done');
    expect(signed).toHaveLength(1);
    expect(calls.execute).toHaveLength(2);
    expect(calls.execute[0]![1]).toBe(calls.execute[1]![1]);
  });

  it('上报回 new_idempotency_key：换键重发，产物与 intent 不变', async () => {
    const {client, calls} = fakeClient({
      execute: (n) => (n === 1 ? bizError(420606, 'new_idempotency_key') : snap({...INTENT, client_intent_id: 'uuid-1'}, {exec: 4})),
    });
    const {d, signed} = deps(client);
    expect((await SwapRun.start(d, INTENT, null).run()).stage).toBe('done');
    expect(signed).toHaveLength(1);
    expect(calls.execute[0]![1]).not.toBe(calls.execute[1]![1]);
    expect(calls.execute[0]![0]).toEqual(calls.execute[1]![0]);
  });

  it('上报回 get_snapshot 类错误：取快照跟进，不重签', async () => {
    const {client, calls} = fakeClient({execute: () => bizError(100607, 'get_snapshot')});
    const {d, signed} = deps(client);
    await SwapRun.start(d, INTENT, null).run();
    expect(signed).toHaveLength(1);
    expect(calls.execute).toHaveLength(1);
    expect(calls.get).toBe(1);
  });
});

describe('签完未上报 → 刷新 → 恢复', () => {
  it('故障注入停在「已落盘未上报」；新实例从存储恢复，只上报原产物、不重签', async () => {
    const storage = memoryStorage();
    const first = fakeClient({});
    const a = deps(first.client, {stopAfterSign: true}, storage);
    const s1 = await SwapRun.start(a.d, INTENT, null).run();
    expect(s1.stage).toBe('stopped');
    expect(first.calls.execute).toHaveLength(0);

    const rec = a.d.store.list()[0]!;
    expect(rec.artifact).not.toBeNull();
    expect(rec.reported).toBe(false);

    // 「刷新页面」：新的客户端、新的依赖，同一份存储
    const second = fakeClient({get: () => snap(rec.intent)});
    const b = deps(second.client, {}, storage);
    const s2 = await new SwapRun(b.d, b.d.store.list()[0]!).resume();
    expect(s2.stage).toBe('done');
    expect(b.signed).toHaveLength(0);
    expect(second.calls.execute).toHaveLength(1);
    expect(second.calls.execute[0]![0]).toEqual(rec.artifact);
    expect(second.calls.execute[0]![1]).toBe(rec.execution_key);
  });

  it('服务端已有执行记录而本地没有产物：只跟进，不签', async () => {
    const {client, calls} = fakeClient({get: () => snap({...INTENT, client_intent_id: 'c'}, {exec: 4})});
    const {d, signed} = deps(client);
    const rec = {client_intent_id: 'c', intent: {...INTENT, client_intent_id: 'c'}, create_key: 'k', accepted_min_out_raw: null, swap_id: 'sw1', artifact: null, execution_key: null, reported: false, updated_at: ''};
    await new SwapRun(d, rec).resume();
    expect(signed).toHaveLength(0);
    expect(calls.execute).toHaveLength(0);
  });
});

describe('准备阶段', () => {
  it('过期后对同一个 swap refresh 一次再签', async () => {
    const {client, calls} = fakeClient({
      create: (i) => snap(i, {prep: {status: 4, retry_after_ms: null}}),
      refresh: () => snap({...INTENT, client_intent_id: 'uuid-1'}, {prep: {status: 2, current_revision: '2'}}),
    });
    const {d, signed} = deps(client);
    const s = await SwapRun.start(d, INTENT, null).run();
    expect(s.stage).toBe('done');
    expect(calls.refresh).toBe(1);
    expect(calls.create).toHaveLength(1);
    expect(signed).toHaveLength(1);
    expect(calls.execute[0]![0].revision).toBe('2');
  });

  it('refresh 之后又过期：停下「签名超时」，不再刷新', async () => {
    const {client, calls} = fakeClient({
      create: (i) => snap(i, {prep: {status: 4, retry_after_ms: null}}),
      refresh: () => snap({...INTENT, client_intent_id: 'uuid-1'}, {prep: {status: 4, retry_after_ms: null}}),
    });
    const {d, signed} = deps(client);
    const s = await SwapRun.start(d, INTENT, null).run();
    expect(s.stage).toBe('stopped');
    expect(s.stopReason).toContain('签名超时');
    expect(calls.refresh).toBe(1);
    expect(signed).toHaveLength(0);
  });

  it('等过期（故障注入）：不签，等到 EXPIRED 后走 refresh', async () => {
    const {client, calls} = fakeClient({
      events: (after, n) =>
        n === 1
          ? {contract_version: 'fast-swap.v1', items: [{swap_id: 'sw1', event_version: '2', type: 1, occurred_at: '', trace_id: '', snapshot: snap({...INTENT, client_intent_id: 'uuid-1'}, {prep: {status: 4, retry_after_ms: null}, version: '2'})}], next_version: '2', reset_required: false, poll_after_ms: 1000}
          : terminal(snap({...INTENT, client_intent_id: 'uuid-1'}, {prep: {current_revision: '2'}})),
      refresh: () => snap({...INTENT, client_intent_id: 'uuid-1'}, {prep: {status: 2, current_revision: '2'}}),
    });
    const {d, signed} = deps(client, {waitUntilExpired: true});
    const s = await SwapRun.start(d, INTENT, null).run();
    expect(calls.refresh).toBe(1);
    expect(signed).toHaveLength(1);
    expect(s.stage).toBe('done');
  });

  it('暂时受阻（BLOCKED + retry_after_ms）：等待后对同一个 swap refresh，而不是只 GET', async () => {
    const {client, calls} = fakeClient({
      create: (i) => snap(i, {prep: {status: 5, current_revision: null, retry_after_ms: 2000, reason_code: 'FASTSWAP_SPONSOR_UNAVAILABLE'}}),
      refresh: () => snap({...INTENT, client_intent_id: 'uuid-1'}, {prep: {status: 2, current_revision: '1'}}),
    });
    const {d, signed} = deps(client);
    const s = await SwapRun.start(d, INTENT, null).run();
    expect(s.stage).toBe('done');
    expect(calls.refresh).toBe(1);
    expect(calls.get).toBe(0);
    expect(signed).toHaveLength(1);
  });

  it('暂时受阻一直不好：refresh 5 轮后停下', async () => {
    const blocked = () => snap({...INTENT, client_intent_id: 'uuid-1'}, {prep: {status: 5, current_revision: null, retry_after_ms: 2000, reason_code: 'FASTSWAP_SPONSOR_UNAVAILABLE'}});
    const {client, calls} = fakeClient({create: () => blocked(), refresh: () => blocked()});
    const {d, signed} = deps(client);
    const s = await SwapRun.start(d, INTENT, null).run();
    expect(s.stage).toBe('stopped');
    expect(s.stopReason).toContain('FASTSWAP_SPONSOR_UNAVAILABLE');
    expect(calls.refresh).toBe(5);
    expect(signed).toHaveLength(0);
  });

  it('永久受阻（BLOCKED 且无 retry_after_ms）：停下，不轮询', async () => {
    const {client, calls} = fakeClient({create: (i) => snap(i, {prep: {status: 5, retry_after_ms: null, reason_code: 'route_unsupported'}})});
    const {d} = deps(client);
    const s = await SwapRun.start(d, INTENT, null).run();
    expect(s.stage).toBe('stopped');
    expect(calls.events).toHaveLength(0);
  });

  it('认不出的 preparation.status：停在未知，不签', async () => {
    const {client} = fakeClient({create: (i) => snap(i, {prep: {status: 42}})});
    const {d, signed} = deps(client);
    expect((await SwapRun.start(d, INTENT, null).run()).stage).toBe('stopped');
    expect(signed).toHaveLength(0);
  });
});

describe('签名前后的守卫', () => {
  it('签前核对不过（服务端 intent 被改）：不调用钱包', async () => {
    const {client, calls} = fakeClient({create: (i) => snap({...i, amount_in_raw: '999999999'})});
    const {d, signed} = deps(client);
    const s = await SwapRun.start(d, INTENT, null).run();
    expect(s.stage).toBe('stopped');
    expect(s.checks.find((c) => c.id === '1-intent-wallet')?.ok).toBe(false);
    expect(signed).toHaveLength(0);
    expect(calls.execute).toHaveLength(0);
  });

  it('双发（故障注入）：签名锁挡下一次，只签一次、只上报一次', async () => {
    const {client, calls} = fakeClient({});
    const {d, signed} = deps(client, {doubleFire: true});
    const s = await SwapRun.start(d, INTENT, null).run();
    expect(s.stage).toBe('done');
    expect(signed).toHaveLength(1);
    expect(calls.execute).toHaveLength(1);
    expect(s.notes.some((n) => n.text.includes('1 次被签名锁挡下'))).toBe(true);
  });
});

describe('轮询', () => {
  it('reset_required：先取全量快照，再从 next_version 续；poll_after_ms 为 null 才停', async () => {
    const {client, calls} = fakeClient({
      events: (_after, n) =>
        n === 1
          ? {contract_version: 'fast-swap.v1', items: [], next_version: '50', reset_required: true, poll_after_ms: 1000}
          : n === 2
            ? {contract_version: 'fast-swap.v1', items: [], next_version: '50', reset_required: false, poll_after_ms: 1000}
            : terminal(snap({...INTENT, client_intent_id: 'uuid-1'})),
    });
    const {d} = deps(client);
    const s = await SwapRun.start(d, INTENT, null).run();
    expect(s.stage).toBe('done');
    expect(calls.get).toBe(1);
    expect(calls.events).toEqual(['1', '50', '50']);
  });
});
