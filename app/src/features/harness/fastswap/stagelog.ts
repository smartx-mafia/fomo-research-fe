// 一笔下单的**前端**时间线：给「过程」日志写行，也给交易卡那张时间线表出数据。
//
// 为什么要有它：报障时第一句总是「哪一笔、卡在哪、卡了多久」。trade_id 是拿去
// trade-trace / 查库的钥匙（v2 接口上叫 swap_id），而日志行自带的时刻只到秒，
// 分不出签名 300ms 还是 3s。
//
// 表的形状照 trade-trace skill 的「lifecycle 时间线」：时刻 / 谁 / 在做什么 /
// 距上一步 / 距开始 / 阶段，关键行在时刻前打标记 —— 只是行全部来自本页自己看到的，
// 不含后端 subject_events、日志与链上。
//
// 表只留关键点，一笔压在六七行：点执行 → 建单 → [刷新] → 请签名 →
// 上报 → 轮询 → 收尾。内部阶段切换（准备 / 签前核对 / 进入上报 / 进入轮询）与准备期
// 反复取快照不单独成行 —— 它们的耗时落在下一行的「距上一步」里，也在「各阶段耗时」里；
// 同一种请求的重试 / 多次轮询合成一行，只记首次时刻与次数。
//
// 纯逻辑，不碰 React：SwapPanel 在 onUpdate 里喂 RunState、在 client 的 onTiming
// 里喂 HttpTiming。放在 onUpdate 而不是 useEffect 里，是因为 React 会合并同一拍里的
// 多次 setRun，快的阶段（checking → signing）在 effect 里会被整段吞掉。

import type {HttpTiming} from './client';
import type {RunState, Stage, Timeline} from './flow';
import {Outcome, outcomeLabel} from './wire';

const STAGE_LABEL: Record<Stage, string> = {
  creating: '建单',
  preparing: '准备',
  refreshing: '刷新报价',
  checking: '签前核对',
  signing: '签名',
  reporting: '上报',
  polling: '等终态',
  done: '终态',
  stopped: '停下',
};

/**
 * 标记（与 trade-trace 同义，都带 U+FE0F，别删）：
 *   ▶️ 用户点执行（距开始的零点）· ✍️ 签名后回传（首次 POST /executions）
 *   ✅ 前端判定成交 · ❌ 前端判定失败 · ⏹️ 前端停下但没拿到结论 —— 后三个一张表只出一个
 */
export type TraceMark = '▶️' | '✍️' | '✅' | '❌' | '⏹️';

export type TraceRow = {
  /** 同 key 的 HTTP 请求合成一行。 */
  key?: string;
  /** 单调时钟 ms（performance.now），只用来排序与算差。 */
  t: number;
  /** 本地时区 HH:MM:SS.mmm。 */
  at: string;
  who: string;
  what: string;
  /** 阶段翻转，形如 `签名 → 上报`；不翻转的行为空。 */
  flip?: string;
  mark?: TraceMark;
  bad?: boolean;
};

/** 合并中的 HTTP 行：次数 / 失败数 / 最后一次往返。 */
type HttpAgg = {key: string; count: number; fails: number; lastRtt: string; label: string};

export type TraceView = {
  swapID: string | null;
  /**
   * 与 trade_id 同行展示的 x-request-id：新下单取建单那次（成功的那次重试），
   * 恢复 / 跟进没有建单，取这一轮第一个成功的请求。都没成功就取第一次发出的。
   */
  requestID: string | null;
  clientIntentID: string;
  rows: (TraceRow & {sincePrev: number | null; sinceStart: number})[];
  /** 各阶段累计耗时（同名阶段合并），按首次出现排序。 */
  stages: {stage: string; ms: number}[];
  total: number;
  /** 「距上一步」最长的那一行的下标 —— 这一笔的瓶颈。 */
  slowest: number | null;
  /** 已停在终态 / 停下。 */
  closed: boolean;
};

type Mark = {stage: Stage; t: number};

/** 本地时区 HH:MM:SS.mmm。 */
export function clock(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** ISO 串转本地毫秒时刻；解析不了就原样返回。 */
function clockISO(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : clock(d);
}

export function secs(ms: number): string {
  return `${(ms / 1000).toFixed(3)}s`;
}

/**
 * 每条路径在表里归到哪一行。返回 null 的不进表：取快照（准备期的内部轮询），
 * 以及与这一笔无关的 quote / capabilities / active / telemetry。
 */
function describeHttp(method: string, path: string): {key: string; label: string} | null {
  const p = path.split('?')[0];
  if (method === 'POST' && p === '/v2/swaps') return {key: 'create', label: '建单'};
  if (p.endsWith('/executions')) return {key: 'execute', label: '上报签名'};
  if (p.endsWith('/refresh')) return {key: 'refresh', label: '刷新报价'};
  if (p.endsWith('/cancel')) return {key: 'cancel', label: '取消'};
  if (p.endsWith('/events')) return {key: 'events', label: '轮询终态'};
  return null;
}

export class StageLog {
  private marks: Mark[] = [];
  private rows: TraceRow[] = [];
  private swapID: string | null = null;
  private clientIntentID = '';
  private closed = false;
  private requestID: string | null = null;
  private requestIDFinal = false;
  private createSeen = false;
  private agg = new Map<string, HttpAgg>();
  private readonly t0: number;
  private readonly wall0: number;

  /**
   * @param now   单调时钟（performance.now），与 client 的 HttpTiming 同一个钟
   * @param wall  墙钟，只在构造时读一次，其余时刻由单调钟推出 —— 两个钟混用会让行乱序
   * @param start ▶️ 那一行写什么（新下单 / 恢复 / 跟进 / 取消）
   */
  constructor(
    private readonly now: () => number,
    wall: () => Date = () => new Date(),
    start = '用户点执行',
  ) {
    this.t0 = now();
    this.wall0 = wall().getTime();
    this.rows.push({t: this.t0, at: this.at(this.t0), who: '用户 / 前端', what: start, mark: '▶️'});
  }

  private at(t: number): string {
    return clock(new Date(this.wall0 + (t - this.t0)));
  }

  private tag(s: {clientIntentID: string}): string {
    return this.swapID ? `[trade_id ${this.swapID}]` : `[intent ${s.clientIntentID}]`;
  }

  /** 喂一次 RunState，返回这一拍该写进「过程」日志的行（多数时候是空）。 */
  observe(s: RunState): string[] {
    const out: string[] = [];
    const t = this.now();
    this.clientIntentID = s.clientIntentID;

    if (s.swapID && s.swapID !== this.swapID) {
      this.swapID = s.swapID;
      out.push(
        `${this.tag(s)} 拿到 trade_id（swap_id）· request_id=${this.requestID ?? '—'} · client_intent_id=${s.clientIntentID} · ${this.at(t)} · 距开始 ${secs(t - this.t0)}`,
      );
      // 表格行里不写 trade_id：它已经在表头那一行（与 request_id 同行）
    }

    const last = this.marks.at(-1);
    if (!last || last.stage !== s.stage) {
      this.marks.push({stage: s.stage, t});
      const flip = last ? `${STAGE_LABEL[last.stage]} → ${STAGE_LABEL[s.stage]}` : `→ ${STAGE_LABEL[s.stage]}`;
      if (!last) {
        out.push(`${this.tag(s)} ${this.at(t)} 开始 → ${STAGE_LABEL[s.stage]}`);
      } else {
        out.push(
          `${this.tag(s)} ${this.at(t)} ${flip}` +
            ` · ${STAGE_LABEL[last.stage]}用时 ${secs(t - last.t)} · 累计 ${secs(t - this.t0)}` +
            (s.stage === 'stopped' && s.stopReason ? ` · 原因：${s.stopReason}` : ''),
        );
      }
      const row = this.stageRow(s);
      if (row) this.rows.push({t, at: this.at(t), flip, ...row});
    }
    return out;
  }

  /** 阶段翻转那一行的「谁 / 在做什么 / 标记」；内部阶段返回 null，不成行。 */
  private stageRow(s: RunState): Pick<TraceRow, 'who' | 'what' | 'mark' | 'bad'> | null {
    switch (s.stage) {
      case 'signing':
        return {who: '前端 → Privy', what: '请 Privy 签名（静默）'};
      case 'done': {
        this.closed = true;
        const o = s.snapshot?.settlement.outcome;
        return o === Outcome.COMPLETED
          ? {who: '前端', what: '判定成交，停止轮询', mark: '✅'}
          : {who: '前端', what: `判定失败（${outcomeLabel(o)}），停止轮询`, mark: '❌', bad: true};
      }
      case 'stopped':
        this.closed = true;
        return {who: '前端', what: `停下，没拿到结论：${s.stopReason ?? '未说明'}`, mark: '⏹️', bad: true};
      default:
        return null;
    }
  }

  /** 喂一次 HTTP 往返（client 的 onTiming）。与这一笔无关的路径不收。 */
  http(h: HttpTiming): void {
    if (!this.closed) this.pickRequestID(h);
    const d = describeHttp(h.method, h.path);
    if (!d || this.closed) return;
    const end = h.parsedAt ?? h.bodyAt ?? h.headersAt;
    const lastRtt = end === undefined ? '没收到响应' : `${Math.round(end - h.startedAt)}ms`;
    const a = this.agg.get(d.key);
    if (a) {
      a.count++;
      a.fails += h.ok ? 0 : 1;
      a.lastRtt = lastRtt;
      return;
    }
    this.agg.set(d.key, {key: d.key, count: 1, fails: h.ok ? 0 : 1, lastRtt, label: d.label});
    const signed = d.key === 'execute';
    this.rows.push({
      key: d.key,
      t: h.startedAt,
      at: this.at(h.startedAt),
      who: signed ? '用户 / 前端' : '前端 → business',
      what: d.label,
      mark: signed ? '✍️' : undefined,
    });
  }

  /** 挑与 trade_id 同行展示的 request_id，规则见 TraceView.requestID。 */
  private pickRequestID(h: HttpTiming) {
    if (this.requestIDFinal) return;
    const p = h.path.split('?')[0];
    const isCreate = h.method === 'POST' && p === '/v2/swaps';
    const isSnapshot = h.method === 'GET' && /^\/v2\/swaps\/[^/]+$/.test(p) && !/\/(capabilities|active)$/.test(p);
    if (!isCreate && !isSnapshot && !describeHttp(h.method, h.path)) return;
    if (isCreate) this.createSeen = true;
    // 建单成功的那次一锤定音；没有建单（恢复 / 跟进）时，第一个成功的请求定音
    if (h.ok && (isCreate || !this.createSeen)) {
      this.requestID = h.sentRequestID;
      this.requestIDFinal = true;
    } else if (!this.requestID) {
      this.requestID = h.sentRequestID;
    }
  }

  /** 合并行的正文：首次之外的次数与失败数才写，只有一次就只写往返。 */
  private httpText(a: HttpAgg): {what: string; bad: boolean} {
    const bits = [a.label];
    if (a.count === 1) bits.push(a.lastRtt === '没收到响应' ? a.lastRtt : `往返 ${a.lastRtt}`);
    else bits.push(`${a.count} 次${a.key === 'events' ? '' : '（含重试）'}，最后一次 ${a.lastRtt}`);
    if (a.fails) bits.push(`失败 ${a.fails} 次`);
    // 失败只在「最后也没成」时标红：重试成功的那种不是问题
    return {what: bits.join(' · '), bad: a.fails > 0 && a.fails === a.count};
  }

  view(): TraceView {
    const rows = [...this.rows].sort((a, b) => a.t - b.t);
    let slowest: number | null = null;
    let slowestMs = -1;
    const out = rows.map((r, i) => {
      const sincePrev = i === 0 ? null : r.t - rows[i - 1].t;
      if (sincePrev !== null && sincePrev > slowestMs) {
        slowest = i;
        slowestMs = sincePrev;
      }
      const a = r.key ? this.agg.get(r.key) : undefined;
      return {...r, ...(a ? this.httpText(a) : {}), sincePrev, sinceStart: r.t - this.t0};
    });
    return {
      swapID: this.swapID,
      requestID: this.requestID,
      clientIntentID: this.clientIntentID,
      rows: out,
      stages: this.stageTotals(),
      total: (rows.at(-1)?.t ?? this.t0) - this.t0,
      slowest,
      closed: this.closed,
    };
  }

  private stageTotals(): {stage: string; ms: number}[] {
    const acc = new Map<Stage, number>();
    for (let i = 0; i + 1 < this.marks.length; i++) {
      const m = this.marks[i];
      acc.set(m.stage, (acc.get(m.stage) ?? 0) + (this.marks[i + 1].t - m.t));
    }
    return [...acc].map(([st, ms]) => ({stage: STAGE_LABEL[st], ms}));
  }

  /** 收尾汇总（写进「过程」日志）：各段耗时、flow 自带的时间线指标、本机首见的链上时刻。 */
  summary(s: RunState): string {
    const parts: string[] = [];
    const end = this.marks.at(-1);
    if (end && this.marks.length > 1) {
      parts.push(
        this.stageTotals()
          .map((x) => `${x.stage} ${secs(x.ms)}`)
          .join(' · ') + ` · 总计 ${secs(end.t - this.t0)}（${this.at(this.t0)} → ${this.at(end.t)}）`,
      );
    }

    const tl: Timeline = s.timeline;
    const m: string[] = [];
    if (tl.create_ms !== undefined) m.push(`create_ms=${Math.round(tl.create_ms)}`);
    if (tl.privy_sign_ms !== undefined) m.push(`privy_sign_ms=${Math.round(tl.privy_sign_ms)}`);
    if (tl.serialize_ms !== undefined) m.push(`serialize_ms=${Math.round(tl.serialize_ms)}`);
    const h = tl.execution_http?.at(-1);
    if (h?.parsed !== undefined) {
      m.push(`execution_http_ms=${Math.round(h.parsed - h.start)}（${tl.execution_http!.length} 次尝试）`);
    }
    if (m.length) parts.push(m.join(' · '));

    const seen: string[] = [];
    const src = clockISO(tl.source_confirmed_at);
    const dst = clockISO(tl.destination_observed_at);
    const acct = clockISO(tl.accounting_posted_at);
    if (src) seen.push(`源链确认 ${src}`);
    if (dst) seen.push(`目标链观测 ${dst}`);
    if (acct) seen.push(`记账 ${acct}`);
    if (seen.length) parts.push(`本机首见：${seen.join(' · ')}`);

    return `${this.tag(s)} 耗时明细（${STAGE_LABEL[s.stage]}）：${parts.join('；') || '无记录'}`;
  }
}
