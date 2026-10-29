import {describe, expect, it} from 'vitest';
import type {HttpTiming} from './client';
import type {RunState} from './flow';
import {Outcome} from './wire';
import {StageLog, clock} from './stagelog';

const base = (patch: Partial<RunState> = {}): RunState => ({
  stage: 'creating',
  clientIntentID: 'cid-1',
  swapID: null,
  snapshot: null,
  checks: [],
  timeline: {},
  notes: [],
  error: null,
  stopReason: null,
  ...patch,
});

function harness() {
  let t = 0;
  const log = new StageLog(
    () => t,
    () => new Date(2026, 8, 18, 10, 0, 0, t),
  );
  return {log, at: (ms: number) => (t = ms)};
}

describe('clock', () => {
  it('补零到毫秒', () => {
    expect(clock(new Date(2026, 0, 1, 1, 2, 3, 4))).toBe('01:02:03.004');
  });
});

describe('StageLog', () => {
  it('建单前用 intent 标记，拿到 swap_id 后改用 trade_id', () => {
    const {log, at} = harness();
    expect(log.observe(base())).toEqual(['[intent cid-1] 10:00:00.000 开始 → 建单']);
    at(1200);
    // 真实顺序：client 在 finally 里先报 onTiming，flow 随后才拿到回包 —— request_id 先于 trade_id 到
    log.http({path: '/v2/swaps', method: 'POST', sentRequestID: 'rq-1', startedAt: 0, parsedAt: 1100, ok: true});
    const lines = log.observe(base({stage: 'preparing', swapID: 'T1'}));
    expect(lines[0]).toBe('[trade_id T1] 拿到 trade_id（swap_id）· request_id=rq-1 · client_intent_id=cid-1 · 10:00:01.200 · 距开始 1.200s');
    expect(lines[1]).toBe('[trade_id T1] 10:00:01.200 建单 → 准备 · 建单用时 1.200s · 累计 1.200s');
    expect(log.view().requestID).toBe('rq-1');
  });

  it('同一阶段重复更新不重复记', () => {
    const {log, at} = harness();
    log.observe(base());
    at(10);
    expect(log.observe(base())).toEqual([]);
  });

  it('停下时带原因', () => {
    const {log, at} = harness();
    log.observe(base({swapID: 'T1'}));
    at(500);
    const [line] = log.observe(base({swapID: 'T1', stage: 'stopped', stopReason: '签名超时'}));
    expect(line).toContain('建单 → 停下');
    expect(line).toContain('原因：签名超时');
  });

  it('汇总：各段耗时合并同名阶段，并带 flow 指标', () => {
    const {log, at} = harness();
    const s = base({swapID: 'T1'});
    log.observe(s);
    at(100);
    log.observe({...s, stage: 'refreshing'});
    at(300);
    log.observe({...s, stage: 'checking'});
    at(350);
    log.observe({...s, stage: 'refreshing'});
    at(450);
    const end = {
      ...s,
      stage: 'done' as const,
      timeline: {create_ms: 99.6, privy_sign_ms: 812, execution_http: [{start: 0, parsed: 240}]},
    };
    log.observe(end);
    const sum = log.summary(end);
    expect(sum).toContain('[trade_id T1] 耗时明细（终态）');
    expect(sum).toContain('建单 0.100s · 刷新报价 0.300s · 签前核对 0.050s · 总计 0.450s');
    expect(sum).toContain('create_ms=100 · privy_sign_ms=812 · execution_http_ms=240（1 次尝试）');
  });
});

const http = (patch: Partial<HttpTiming>): HttpTiming => ({
  path: '/v2/swaps',
  method: 'POST',
  sentRequestID: 'rq',
  startedAt: 0,
  ok: true,
  ...patch,
});

describe('StageLog.view（交易卡时间线表）', () => {
  it('只留关键点：内部阶段不成行，行里不写 trade_id，重试与轮询各合成一行', () => {
    const {log, at} = harness();
    const s = base();
    log.observe(s);
    // 建单请求在 10ms 发出、回包在 900ms 才报上来 —— 表里仍按发出时刻排
    at(900);
    log.http(http({startedAt: 10, parsedAt: 890}));
    log.observe({...s, swapID: 'T1', stage: 'preparing'});
    log.http(http({path: '/v2/swaps/T1', method: 'GET', startedAt: 950, parsedAt: 1000})); // 取快照：不成行
    at(1000);
    log.observe({...s, swapID: 'T1', stage: 'checking'});
    at(1100);
    log.observe({...s, swapID: 'T1', stage: 'signing'});
    at(3000);
    log.observe({...s, swapID: 'T1', stage: 'reporting'});
    log.http(http({path: '/v2/swaps/T1/executions', startedAt: 3000, ok: false}));
    log.http(http({path: '/v2/swaps/T1/executions', startedAt: 3300, parsedAt: 3400}));
    log.http(http({path: '/v2/swaps/quote', startedAt: 3500})); // 与这一笔无关
    at(3500);
    log.observe({...s, swapID: 'T1', stage: 'polling'});
    for (const t of [3500, 5500, 7500]) log.http(http({path: '/v2/swaps/T1/events', method: 'GET', startedAt: t, parsedAt: t + 50}));
    at(7600);
    log.observe({
      ...s,
      swapID: 'T1',
      stage: 'done',
      snapshot: {settlement: {outcome: Outcome.COMPLETED}} as RunState['snapshot'],
    });

    const v = log.view();
    expect(v.swapID).toBe('T1');
    expect(v.closed).toBe(true);
    expect(v.total).toBe(7600);
    expect(v.rows.map((r) => [r.at, r.mark ?? '', r.what, !!r.bad])).toEqual([
      ['10:00:00.000', '▶️', '用户点执行', false],
      ['10:00:00.010', '', '建单 · 往返 880ms', false],
      ['10:00:01.100', '', '请 Privy 签名（静默）', false],
      ['10:00:03.000', '✍️', '上报签名 · 2 次（含重试），最后一次 100ms · 失败 1 次', false],
      ['10:00:03.500', '', '轮询终态 · 3 次，最后一次 50ms', false],
      ['10:00:07.600', '✅', '判定成交，停止轮询', false],
    ]);
    expect(v.rows[2].flip).toBe('签前核对 → 签名');
    // 最长的一段：最后一次轮询到判定成交 4.1s
    expect(v.slowest).toBe(5);
    expect(v.stages.map((x) => x.stage)).toEqual(['建单', '准备', '签前核对', '签名', '上报', '等终态']);
  });

  it('request_id：建单失败重试取成功那次；恢复时取第一个成功的请求', () => {
    const a = harness();
    a.log.http(http({sentRequestID: 'c1', ok: false}));
    expect(a.log.view().requestID).toBe('c1');
    a.log.http(http({sentRequestID: 'c2', startedAt: 5}));
    a.log.http(http({path: '/v2/swaps/T1', method: 'GET', sentRequestID: 'g1', startedAt: 9}));
    expect(a.log.view().requestID).toBe('c2');

    const b = harness();
    b.log.http(http({path: '/v2/swaps/quote', sentRequestID: 'q'})); // 无关请求不算
    b.log.http(http({path: '/v2/swaps/T1', method: 'GET', sentRequestID: 'g0', ok: false}));
    b.log.http(http({path: '/v2/swaps/T1', method: 'GET', sentRequestID: 'g1'}));
    b.log.http(http({path: '/v2/swaps/T1/events', method: 'GET', sentRequestID: 'e1'}));
    expect(b.log.view().requestID).toBe('g1');
  });

  it('非完成的终态标 ❌，停下标 ⏹️', () => {
    const a = harness();
    a.log.observe(base({swapID: 'T1'}));
    a.log.observe(
      base({swapID: 'T1', stage: 'done', snapshot: {settlement: {outcome: Outcome.REFUNDED}} as RunState['snapshot']}),
    );
    expect(a.log.view().rows.at(-1)?.mark).toBe('❌');

    const b = harness();
    b.log.observe(base());
    b.log.observe(base({stage: 'stopped', stopReason: '签名超时'}));
    const last = b.log.view().rows.at(-1)!;
    expect([last.mark, last.what, last.bad]).toEqual(['⏹️', '停下，没拿到结论：签名超时', true]);
  });

  it('全部失败才标红，没回包写明', () => {
    const {log} = harness();
    log.http(http({path: '/v2/swaps/T1/events', method: 'GET', ok: false, startedAt: 5}));
    const r = log.view().rows[1];
    expect(r.bad).toBe(true);
    expect(r.what).toBe('轮询终态 · 没收到响应 · 失败 1 次');
  });
});
