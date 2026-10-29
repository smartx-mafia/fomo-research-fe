// 一键流程的编排：建单 → 准备 → 签前核对 → 签名 → 签后核对 → 落盘 → 上报 → 轮询到终态。
//
// 这一层不碰 React、不碰 Privy：HTTP、签名器、存储、锁、时钟全部注入，
// 于是每一条恢复分支都能在单测里用假件逐条走到（fastswap-app.md §9 的验收清单）。
//
// 三条贯穿全程的纪律：
//   ① 错误**按 `recovery_action` 分支，不按码分支**（fastswap.md §9.1）；
//   ② 超时 / 丢响应一律**用同一个幂等键**重发，`client_intent_id` 永不更换；
//   ③ 一旦存在签名产物，之后的任何路径都只许上报它，**绝不重签**。

import {SwapApiError, type HttpTiming, type SwapClient} from './client';
import type {SwapRecord, SwapStore} from './store';
import {LockBusyError} from './store';
import {
  authSignatureHex,
  evmPostSign,
  evmPreSign,
  failed,
  preSignChecks,
  solanaPostSign,
  solanaPreSign,
  typedDataToSign,
  type Check,
} from './verify';
import {
  AccountingStatus,
  ChainLegStatus,
  ExecutionStatus,
  PreparationStatus,
  type CreateIntent,
  type EvmSigning,
  type ExecutionReport,
  type SwapSnapshot,
  type TelemetryEvent,
} from './wire';
import {fromBase64} from '../signature';

// ---------------------------------------------------------------------------
// 注入件
// ---------------------------------------------------------------------------

export type Signer = {
  /** 只签不发。进：服务端交来的完整交易字节；出：签好的完整交易字节。 */
  solana(tx: Uint8Array, address: string): Promise<Uint8Array>;
  typedData(typed: ReturnType<typeof typedDataToSign>, address: string): Promise<string>;
  authorization7702(
    input: {contractAddress: string; chainId: number; nonce: number},
    address: string,
  ): Promise<{r: string; s: string; yParity: number}>;
};

/** 故障注入开关（对齐会话 Q14）。每个只影响下一次，用过即复位。 */
export type Faults = {
  /** 建单请求照发，但假装没收到回包，随后用同一个 intent 与幂等键重发。 */
  dropCreateResponse: boolean;
  /** 签完、落盘之后直接停下，不上报 —— 用来验刷新页面后的恢复。 */
  stopAfterSign: boolean;
  /** 上报请求照发，但假装没收到回包，随后用原幂等键重发。 */
  dropExecutionResponse: boolean;
  /** 拿到可签版本后不签，等它过期 —— 用来验 `/refresh`。 */
  waitUntilExpired: boolean;
  /** 同时发起两次「签名 + 上报」—— 用来验签名锁。 */
  doubleFire: boolean;
};

export const NO_FAULTS: Faults = {
  dropCreateResponse: false,
  stopAfterSign: false,
  dropExecutionResponse: false,
  waitUntilExpired: false,
  doubleFire: false,
};

export type FlowDeps = {
  client: SwapClient;
  store: SwapStore;
  signer: Signer;
  /** 账户键：锁名与存储分桶都用它。 */
  account: string;
  withLock: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  /** 读取并**复位**一个故障开关。 */
  takeFault: (k: keyof Faults) => boolean;
  now: () => number;
  wall: () => string;
  sleep: (ms: number) => Promise<void>;
  visible: () => boolean;
  uuid: () => string;
  onUpdate: (s: RunState) => void;
  /** 埋点出口；失败不影响交易。 */
  telemetry: (events: TelemetryEvent[]) => Promise<void>;
  /** 这笔的出资钱包地址（签名用）。 */
  walletAddress: string;
};

// ---------------------------------------------------------------------------
// 运行状态（给 UI 看）
// ---------------------------------------------------------------------------

export type Stage =
  | 'creating'
  | 'preparing'
  | 'refreshing'
  | 'ready'
  | 'checking'
  | 'signing'
  | 'reporting'
  | 'polling'
  | 'done'
  | 'stopped';

/** 一笔的时间线（fastswap-app.md §9）。数字是单调时钟 ms，串是 UTC 墙钟。 */
export type Timeline = {
  /** 输入稳定后开始生成完整可签交易。与用户最终确认分开计时。 */
  prepareAt?: number;
  confirmAt?: number;
  readyAt?: number;
  create_ms?: number;
  privy_sign_ms?: number;
  serialize_ms?: number;
  execution_http?: {start: number; headers?: number; body?: number; parsed?: number}[];
  destination_observed_at?: string;
  source_confirmed_at?: string;
  accounting_posted_at?: string;
};

export type RunState = {
  stage: Stage;
  clientIntentID: string;
  swapID: string | null;
  snapshot: SwapSnapshot | null;
  checks: Check[];
  timeline: Timeline;
  notes: {at: string; text: string; bad?: boolean}[];
  error: SwapApiError | Error | null;
  /** 停下来的原因（stage=stopped 时）。 */
  stopReason: string | null;
};

class Stop extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'Stop';
  }
}

const MAX_SAME_KEY_RETRIES = 3;
const MAX_AUTO_REFRESH = 1;
const MAX_BLOCKED_WAITS = 5;

// ---------------------------------------------------------------------------
// 编排
// ---------------------------------------------------------------------------

export class SwapRun {
  private state: RunState;
  private refreshes = 0;
  private receivedAt = 0;
  private record: SwapRecord;

  constructor(
    private readonly d: FlowDeps,
    record: SwapRecord,
  ) {
    this.record = record;
    this.state = {
      stage: 'creating',
      clientIntentID: record.client_intent_id,
      swapID: record.swap_id,
      snapshot: null,
      checks: [],
      timeline: {},
      notes: [],
      error: null,
      stopReason: null,
    };
  }

  /** 新建一笔：生成 intent id 与建单幂等键，**先落盘再发请求**。 */
  static start(d: FlowDeps, intent: Omit<CreateIntent, 'client_intent_id'>, acceptedMinOutRaw: string | null) {
    const cid = d.uuid();
    const rec: SwapRecord = {
      client_intent_id: cid,
      intent: {...intent, client_intent_id: cid},
      create_key: d.uuid(),
      accepted_min_out_raw: acceptedMinOutRaw,
      swap_id: null,
      artifact: null,
      execution_key: null,
      reported: false,
      updated_at: d.wall(),
    };
    d.store.put(rec);
    return new SwapRun(d, rec);
  }

  get snapshotState(): RunState {
    return this.state;
  }

  private emit(patch: Partial<RunState>) {
    this.state = {...this.state, ...patch};
    this.d.onUpdate(this.state);
  }

  private note(text: string, bad = false) {
    this.emit({notes: [...this.state.notes, {at: this.d.wall(), text, bad}]});
  }

  private save(patch: Partial<SwapRecord>) {
    this.record = {...this.record, ...patch};
    this.d.store.put(this.record);
  }

  private setSnapshot(s: SwapSnapshot) {
    this.receivedAt = this.d.now();
    const tl = {...this.state.timeline};
    const st = s.settlement;
    if (!tl.destination_observed_at && st.destination >= ChainLegStatus.OBSERVED && st.destination !== ChainLegStatus.REORGED)
      tl.destination_observed_at = this.d.wall();
    if (!tl.source_confirmed_at && st.source === ChainLegStatus.CONFIRMED) tl.source_confirmed_at = this.d.wall();
    if (!tl.accounting_posted_at && st.accounting === AccountingStatus.POSTED) tl.accounting_posted_at = this.d.wall();
    if (s.swap_id && this.record.swap_id !== s.swap_id) this.save({swap_id: s.swap_id});
    this.emit({snapshot: s, swapID: s.swap_id, timeline: tl});
  }

  /** 全流程。任何分支停下都落到 stage=stopped 并写明原因，不抛。 */
  async run(): Promise<RunState> {
    try {
      const started = this.d.now();
      this.emit({timeline: {...this.state.timeline, prepareAt: started, confirmAt: started}});
      const snap = this.record.swap_id ? await this.get() : await this.create();
      await this.untilSignable(snap);
      await this.signAndReport();
      await this.poll();
    } catch (e) {
      this.fail(e);
    } finally {
      void this.flushTelemetry();
    }
    return this.state;
  }

  /**
   * 输入阶段只做到 READY：建立不可变意图、生成完整交易、平台预签并持久化。
   * 不调用钱包，不产生用户签名，也不触发 `/executions`。
   */
  async prepare(): Promise<RunState> {
    try {
      if (this.state.timeline.prepareAt === undefined) {
        this.emit({timeline: {...this.state.timeline, prepareAt: this.d.now()}});
      }
      const snap = this.record.swap_id ? await this.get() : await this.create();
      await this.untilSignable(snap);
      this.emit({stage: 'ready'});
    } catch (e) {
      this.fail(e);
      void this.flushTelemetry();
    }
    return this.state;
  }

  /**
   * 展示报价与 Create 并行时，展示报价可能稍晚回来。用户点击前把其可接受底线
   * 可靠写回同一笔本地恢复记录，随后签前第 7 条会用它核对 READY revision。
   */
  acceptDisplayedQuote(minOutRaw: string): void {
    if (this.record.artifact || this.state.snapshot?.execution.status !== ExecutionStatus.NOT_REPORTED) {
      throw new Stop('这笔已经产生签名或执行记录，不能再修改用户接受的报价底线');
    }
    this.save({accepted_min_out_raw: minOutRaw});
  }

  /**
   * 用户确认后的热路径：复用 prepare() 留下的 swap，只签名、可靠落盘、上报并跟进。
   * 若页面恢复时只有 swap_id，会先 GET 同一笔；绝不新建另一个 intent 绕过恢复。
   */
  async executePrepared(): Promise<RunState> {
    try {
      if (this.state.stage === 'stopped') return this.state;
      this.emit({timeline: {...this.state.timeline, confirmAt: this.d.now()}});
      if (!this.record.swap_id) throw new Stop('预构建尚未拿到 swap_id，不能进入签名热路径');
      // 用户可能在 READY 后停留很久，另一标签页也可能 refresh 同一笔。点击时只 GET
      // 同一个 swap 做一次轻量对账；不重新报价、不新建 intent。若已过期，下面仍按
      // 原协议 refresh 同一笔，绝不签缓存里的旧 revision。
      const snap = await this.get();
      if (snap.execution.status !== ExecutionStatus.NOT_REPORTED) {
        this.note(`点击对账发现服务端已有执行记录（execution=${snap.execution.status}）—— 只跟进，不重签`);
        await this.poll();
        return this.state;
      }
      await this.untilSignable(snap);
      await this.signAndReport();
      await this.poll();
    } catch (e) {
      this.fail(e);
    } finally {
      void this.flushTelemetry();
    }
    return this.state;
  }

  /** 恢复一笔已存在的 swap（在途列表的「恢复」按钮）。 */
  async resume(): Promise<RunState> {
    try {
      let snap = await this.get();
      if (this.record.artifact) {
        this.note('本地存着这笔的签名产物 —— 只上报它，不重签');
        await this.report();
        await this.poll();
        return this.state;
      }
      if (snap.execution.status !== ExecutionStatus.NOT_REPORTED) {
        this.note(`服务端已有执行记录（execution=${snap.execution.status}）—— 只跟进，不签`);
        await this.poll();
        return this.state;
      }
      if (this.record.accepted_min_out_raw == null) {
        throw new Stop('这笔是在用户确认前自动预构建的，没有展示报价底线 —— 回到交易卡重新确认，不在恢复入口签名');
      }
      await this.untilSignable(snap);
      await this.signAndReport();
      await this.poll();
    } catch (e) {
      this.fail(e);
    } finally {
      void this.flushTelemetry();
    }
    return this.state;
  }

  /**
   * 只跟进，不签：本地没有这笔的记录（换了浏览器 / 清过站点数据）时用它。
   * 没有本地确认过的 intent，签前第 1 条就无从核对 —— 所以这条路一律不签。
   */
  async follow(): Promise<RunState> {
    try {
      await this.get();
      this.note('本地没有这笔的记录 —— 只跟进状态，不签名');
      await this.poll();
    } catch (e) {
      this.fail(e);
    }
    return this.state;
  }

  /** 放弃一笔「已建、未签」的 swap。 */
  async cancel(): Promise<RunState> {
    try {
      if (!this.record.swap_id) throw new Stop('还没有 swap_id，没有可取消的东西');
      if (this.record.artifact) throw new Stop('这笔已经签过 —— 签名产物随时可能上链，不能当成没签过来取消');
      const r = await this.d.client.cancel(this.record.swap_id, this.d.uuid());
      this.setSnapshot(r.swap);
      this.note('已请求取消（服务端停止发放新版本，不声称链上撤销）');
      await this.poll();
    } catch (e) {
      this.fail(e);
    }
    return this.state;
  }

  private fail(e: unknown) {
    if (e instanceof Stop) {
      this.note(e.message, true);
      this.emit({stage: 'stopped', stopReason: e.message});
      return;
    }
    const err = e instanceof Error ? e : new Error(String(e));
    this.note(`出错：${err.message}`, true);
    this.emit({stage: 'stopped', stopReason: err.message, error: err});
  }

  // ── 建单 ──────────────────────────────────────────────────────────

  private async create(): Promise<SwapSnapshot> {
    this.emit({stage: 'creating'});
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await this.d.client.create(this.record.intent, this.record.create_key);
        if (this.d.takeFault('dropCreateResponse')) {
          this.note('【故障注入】建单回包被丢弃 —— 用同一个 intent 与幂等键重发');
          continue;
        }
        this.setSnapshot(r.swap);
        this.note(`建单完成：swap_id=${r.swap.swap_id}`);
        return r.swap;
      } catch (e) {
        await this.recover(e, attempt, '建单');
      }
    }
  }

  private async get(): Promise<SwapSnapshot> {
    const r = await this.d.client.get(this.record.swap_id!);
    this.setSnapshot(r.swap);
    return r.swap;
  }

  /**
   * 错误恢复：按 recovery_action 分支。能重试就退避后返回（调用方用同一个键重发），
   * 否则抛 Stop。网络层失败（没到信封）一律当「结果不明」，同键重发。
   */
  private async recover(e: unknown, attempt: number, what: string): Promise<void> {
    if (!(e instanceof SwapApiError)) throw e;
    if (attempt >= MAX_SAME_KEY_RETRIES) throw e;
    if (e.kind === 'transport' && e.code !== 200 && e.code < 500) throw e; // 裸 403 / 413 / 404：重发不会好
    if (e.kind !== 'business') {
      this.note(`${what}没拿到回包（${e.message}）—— 同一个幂等键重发`, true);
      await this.d.sleep(500 * (attempt + 1));
      return;
    }
    switch (e.recovery) {
      case 'retry_same_request':
        this.note(`${what}：${e.code} retry_same_request —— 退避后原样重发`);
        await this.d.sleep(e.retryAfterMs ?? 1000);
        return;
      default:
        if (e.code === 420603 && e.meta.related_swap_id) {
          // 2026-09-17 起：那笔还没上报签名时服务端已替你撤销它（retry_after_ms = 它那一版的剩余寿命）；
          // 上报过签名则不会撤，要恢复它。两种都不能换 id 绕过（fastswap.md §2.1）。
          throw new Stop(
            `钱包忙：swap ${e.meta.related_swap_id} 占着钱包` +
              (e.retryAfterMs ? `（若它未签，服务端已撤销，约 ${Math.ceil(e.retryAfterMs / 1000)}s 后锁释放）` : '') +
              ' —— 到在途列表看它，不要换 id 绕过',
          );
        }
        throw e;
    }
  }

  // ── 等到可签 ─────────────────────────────────────────────────────

  private async untilSignable(snap: SwapSnapshot): Promise<SwapSnapshot> {
    let blockedWaits = 0;
    let cursor = snap.event_version;
    for (;;) {
      const p = snap.preparation;
      switch (p.status) {
        case PreparationStatus.READY: {
          if (this.d.takeFault('waitUntilExpired')) {
            const wait = (p.retry_after_ms ?? 0) + 6_000;
            this.note(`【故障注入】拿到可签版本但不签，等 ${(wait / 1000).toFixed(0)}s 让它过期`);
            await this.d.sleep(wait);
            snap = await this.waitPreparationChange(snap, cursor);
            cursor = snap.event_version;
            continue;
          }
          if (!this.state.timeline.readyAt) {
            const readyAt = this.d.now();
            this.emit({
              timeline: {
                ...this.state.timeline,
                readyAt,
                create_ms: readyAt - (this.state.timeline.prepareAt ?? this.state.timeline.confirmAt ?? readyAt),
              },
            });
          }
          return snap;
        }
        case PreparationStatus.PREPARING:
        case PreparationStatus.REFRESHING:
          this.emit({stage: p.status === PreparationStatus.PREPARING ? 'preparing' : 'refreshing'});
          snap = await this.waitPreparationChange(snap, cursor);
          cursor = snap.event_version;
          continue;
        case PreparationStatus.EXPIRED:
          if (this.refreshes >= MAX_AUTO_REFRESH) {
            throw new Stop('签名超时：可签版本过期，自动刷新 1 次后又过期 —— 停下，不再重试');
          }
          this.refreshes++;
          this.emit({stage: 'refreshing'});
          this.note('可签版本已过期 —— 对同一个 swap 调 /refresh（不新建）');
          try {
            const r = await this.d.client.refresh(snap.swap_id, this.d.uuid());
            this.setSnapshot(r.swap);
            snap = r.swap;
          } catch (e) {
            if (e instanceof SwapApiError && e.code === 430614) {
              throw new Stop('refresh 被拒（430614，旧版可能仍在链上有效）—— 停下；报价彻底过期后需换新 intent 重建');
            }
            throw e;
          }
          continue;
        case PreparationStatus.BLOCKED:
          if (p.retry_after_ms == null) {
            throw new Stop(`准备受阻且不可恢复（reason=${p.reason_code ?? '无'}）—— 换输入重新建单`);
          }
          if (++blockedWaits > MAX_BLOCKED_WAITS) {
            throw new Stop(`准备持续受阻（reason=${p.reason_code ?? '无'}），已 refresh 5 轮 —— 停下`);
          }
          // 暂时受阻（代付预算不够、钱包锁在别人手里）**不会自己变好**：GET 不重新准备，
          // 要等 retry_after_ms 之后对同一个 swap 显式 /refresh（后端 service/create.go markBlocked 注释）。
          this.note(`准备暂时受阻（reason=${p.reason_code ?? '无'}）—— ${p.retry_after_ms}ms 后对同一个 swap refresh`);
          await this.d.sleep(p.retry_after_ms);
          snap = (await this.d.client.refresh(snap.swap_id, this.d.uuid())).swap;
          this.setSnapshot(snap);
          continue;
        default:
          throw new Stop(`preparation.status=${p.status} 认不出 —— 停在安全的未知状态`);
      }
    }
  }

  /** 轮询事件直到 preparation.status 变化（或终态）。 */
  private async waitPreparationChange(snap: SwapSnapshot, after: string): Promise<SwapSnapshot> {
    const from = snap.preparation.status;
    const fromRev = snap.preparation.current_revision;
    let cursor = after;
    for (;;) {
      const ev = await this.d.client.events(snap.swap_id, cursor);
      if (ev.reset_required) {
        snap = await this.get();
      } else {
        const last = ev.items.at(-1)?.snapshot;
        if (last) {
          this.setSnapshot(last);
          snap = last;
        }
      }
      cursor = ev.next_version;
      if (snap.preparation.status !== from || snap.preparation.current_revision !== fromRev) return snap;
      if (ev.poll_after_ms === null) return snap;
      await this.d.sleep(ev.poll_after_ms);
    }
  }

  // ── 签名 + 上报 ──────────────────────────────────────────────────

  private async signAndReport(): Promise<void> {
    const lockName = `fastswap:${this.d.account}:${this.record.swap_id}`;
    const once = () =>
      this.d.withLock(lockName, async () => {
        if (!this.record.artifact) await this.sign();
        if (this.record.artifact && !this.stopAfterSignRequested) await this.report();
      });
    if (this.d.takeFault('doubleFire')) {
      this.note('【故障注入】同时发起两次「签名 + 上报」');
      const rs = await Promise.allSettled([once(), once()]);
      const busy = rs.filter((r) => r.status === 'rejected' && r.reason instanceof LockBusyError).length;
      this.note(`两次里 ${busy} 次被签名锁挡下（期望 1）`, busy !== 1);
      const other = rs.find((r) => r.status === 'rejected' && !(r.reason instanceof LockBusyError));
      if (other && other.status === 'rejected') throw other.reason;
    } else {
      await once();
    }
    if (this.stopAfterSignRequested) {
      throw new Stop('【故障注入】已签名并落盘，但没有上报 —— 刷新页面后到在途列表点「恢复」');
    }
  }

  private stopAfterSignRequested = false;

  private async sign(): Promise<void> {
    const snap = this.state.snapshot!;
    const rev = snap.revision;
    this.emit({stage: 'checking'});
    const checks = preSignChecks({
      snapshot: snap,
      intent: this.record.intent,
      walletAddress: this.d.walletAddress,
      receivedAt: this.receivedAt,
      now: this.d.now(),
      visible: this.d.visible(),
      hasUnreportedArtifact: !!this.record.artifact && !this.record.reported,
      acceptedMinOutRaw: this.record.accepted_min_out_raw,
    });

    if (rev.solana) {
      const pre = await solanaPreSign(rev.solana);
      checks.push(...pre.checks);
      this.emit({checks});
      if (failed(checks).length > 0 || !pre.decoded) throw new Stop(`签前核对未通过：${failed(checks).map((c) => c.id).join(', ')}`);

      this.emit({stage: 'signing'});
      const t0 = this.d.now();
      const signed = await this.d.signer.solana(fromBase64(rev.solana.transaction_base64), this.d.walletAddress);
      const t1 = this.d.now();
      const post = await solanaPostSign(pre.decoded, signed);
      const all = [...checks, ...post.checks];
      this.emit({checks: all, timeline: {...this.state.timeline, privy_sign_ms: t1 - t0, serialize_ms: this.d.now() - t1}});
      if (!post.signedBase64) throw new Stop(`签后核对未通过：${failed(post.checks).map((c) => c.id).join(', ')}`);
      this.persistArtifact({
        revision: rev.revision,
        intent_hash: rev.intent_hash,
        solana_transaction: {signed_transaction_base64: post.signedBase64},
        evm_signatures: null,
      });
    } else if (rev.evm) {
      checks.push(...evmPreSign(rev.evm, this.record.intent, this.d.walletAddress));
      this.emit({checks});
      if (failed(checks).length > 0) throw new Stop(`签前核对未通过：${failed(checks).map((c) => c.id).join(', ')}`);

      this.emit({stage: 'signing'});
      const t0 = this.d.now();
      const sigs = await this.signEvm(rev.evm);
      const t1 = this.d.now();
      const post = await evmPostSign(rev.evm, sigs);
      const all = [...checks, ...post];
      this.emit({checks: all, timeline: {...this.state.timeline, privy_sign_ms: t1 - t0, serialize_ms: this.d.now() - t1}});
      if (failed(post).length > 0) throw new Stop(`签后核对未通过：${failed(post).map((c) => c.id).join(', ')}`);
      this.persistArtifact({
        revision: rev.revision,
        intent_hash: rev.intent_hash,
        solana_transaction: null,
        evm_signatures: {signatures: sigs},
      });
    } else {
      this.emit({checks});
      throw new Stop('revision 里没有可签材料');
    }

    if (this.d.takeFault('stopAfterSign')) this.stopAfterSignRequested = true;
  }

  private async signEvm(evm: EvmSigning) {
    const out: {request_id: string; signature: string}[] = [];
    for (const r of evm.requests) {
      if (r.typed_data) {
        out.push({request_id: r.request_id, signature: await this.d.signer.typedData(typedDataToSign(r.typed_data), this.d.walletAddress)});
      } else if (r.authorization) {
        const a = r.authorization;
        const sig = await this.d.signer.authorization7702(
          {contractAddress: a.address, chainId: Number(a.chain_id), nonce: Number(a.nonce)},
          this.d.walletAddress,
        );
        out.push({request_id: r.request_id, signature: authSignatureHex(sig.r, sig.s, sig.yParity)});
      }
    }
    return out;
  }

  /** 先落盘，再上报（契约 §7 第 1 条）。 */
  private persistArtifact(report: ExecutionReport) {
    this.save({artifact: report, execution_key: this.d.uuid(), reported: false});
    this.note(`签名产物已落盘（revision=${report.revision}）${this.d.store.durable() ? '' : ' —— ⚠ 只在内存里，刷新就丢'}`);
  }

  private async report(): Promise<void> {
    this.emit({stage: 'reporting'});
    const swapID = this.record.swap_id!;
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await this.d.client.execute(swapID, this.record.artifact!, this.record.execution_key!);
        if (this.d.takeFault('dropExecutionResponse')) {
          this.note('【故障注入】上报回包被丢弃 —— 用原幂等键重发');
          continue;
        }
        this.save({reported: true});
        this.setSnapshot(r.swap);
        const st = r.swap.execution.status;
        this.note(
          st === ExecutionStatus.FAILED
            ? `上报完成：出口当场拒绝（FAILED${r.swap.execution.failure_cause ? `，成因 ${r.swap.execution.failure_cause}，建议 ${r.swap.execution.recovery_action}` : ''}）—— 这一笔不再上报；要重来就建一笔新意图，不重签这一笔`
            : st === ExecutionStatus.UNKNOWN
              ? '上报完成：出口结果未知（UNKNOWN）—— 不是失败，禁止重签，继续观察'
              : `上报完成：execution.status=${st}`,
          st === ExecutionStatus.FAILED,
        );
        return;
      } catch (e) {
        if (e instanceof SwapApiError && e.kind === 'business') {
          if (e.recovery === 'new_idempotency_key' && attempt < MAX_SAME_KEY_RETRIES) {
            this.note('上报：new_idempotency_key —— 换新键，intent 与产物不变，重发');
            this.save({execution_key: this.d.uuid()});
            continue;
          }
          if (e.recovery === 'get_snapshot') {
            this.note(`上报被拒（${e.code} ${e.reason ?? ''}）—— 按 get_snapshot 取快照跟进，不重签`, true);
            await this.get();
            this.save({reported: true});
            return;
          }
        }
        await this.recover(e, attempt, '上报');
      }
    }
  }

  /**
   * 客户端的 onTiming 回调转到这里：每次上报尝试记下「开始 / 响应头 / 响应体 / 解析完成」四个点
   * （fastswap-app.md §9 的 execution_http_ms）。失败的尝试也记，缺的点就是断在那里。
   */
  onHttpTiming(t: HttpTiming) {
    if (!t.path.endsWith('/executions')) return;
    const entry = {start: t.startedAt, headers: t.headersAt, body: t.bodyAt, parsed: t.parsedAt};
    this.emit({timeline: {...this.state.timeline, execution_http: [...(this.state.timeline.execution_http ?? []), entry]}});
  }

  // ── 轮询 ─────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    this.emit({stage: 'polling'});
    const swapID = this.record.swap_id!;
    let cursor = this.state.snapshot?.event_version ?? '';
    for (;;) {
      const ev = await this.d.client.events(swapID, cursor);
      if (ev.reset_required) {
        this.note('事件游标落在保留窗口之外 —— 先取全量快照再续');
        await this.get();
      } else {
        const last = ev.items.at(-1)?.snapshot;
        if (last) this.setSnapshot(last);
      }
      cursor = ev.next_version;
      if (ev.poll_after_ms === null) break;
      await this.d.sleep(ev.poll_after_ms);
    }
    this.d.store.remove(this.record.client_intent_id);
    this.emit({stage: 'done'});
    this.note(`到终态：outcome=${this.state.snapshot?.settlement.outcome}（本地记录已清）`);
  }

  // ── 埋点 ─────────────────────────────────────────────────────────

  private async flushTelemetry() {
    const tl = this.state.timeline;
    const s = this.state.snapshot;
    const base = {
      client_attempt_id: this.record.client_intent_id,
      swap_id: this.record.swap_id ?? undefined,
      revision: s?.preparation.current_revision ?? undefined,
      wall_time: this.d.wall(),
      attributes: {
        route: `${this.record.intent.origin_chain}>${this.record.intent.destination_chain}`.replace(/[^\x20-\x7e]/g, ''),
        wallet_type: 'embedded',
        channel: 'gateway',
        ...(this.state.stage === 'stopped' ? {error_class: this.state.error instanceof SwapApiError ? String(this.state.error.code) : 'stop'} : {}),
      },
    };
    const events: TelemetryEvent[] = [];
    const push = (name: string, ms: number | undefined) => {
      if (ms !== undefined && ms >= 0) events.push({...base, name, monotonic_ms: Math.round(ms)});
    };
    push('create_ms', tl.create_ms);
    push('privy_sign_ms', tl.privy_sign_ms);
    push('serialize_ms', tl.serialize_ms);
    const h = tl.execution_http?.at(-1);
    if (h?.parsed !== undefined) push('execution_http_ms', h.parsed - h.start);
    if (events.length === 0) return;
    try {
      await this.d.telemetry(events);
    } catch {
      /* 埋点失败不阻断交易 */
    }
  }
}
