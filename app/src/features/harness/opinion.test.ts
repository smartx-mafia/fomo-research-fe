import {afterEach, describe, expect, it, vi} from 'vitest';

import {ApiError, type Position} from './api';
import {blockedRuleOf, createOpinion, getOpinionByTarget, opinionTargetOf, updateOpinion} from './opinion';

function stubFetch(body: unknown) {
  const f = vi.fn(async (_url: string, _init?: RequestInit) => ({ok: true, status: 200, text: async () => JSON.stringify(body)}));
  vi.stubGlobal('fetch', f);
  return f;
}

afterEach(() => vi.unstubAllGlobals());

const pos = (over: Partial<Position>): Position =>
  ({
    asset: {chain: 'bsc', chain_id: 56, kind: 'erc20', token_address: '0xabc'},
    cycle_status: 'ready',
    opened_entry_id: 7,
    ...over,
  }) as Position;

describe('opinionTargetOf：仓位 → 观点 target_id', () => {
  it('四段式与后端 EncodePositionTargetID 同形（chain_id:kind:地址:开仓分录）', () => {
    expect(opinionTargetOf(pos({}))).toBe('56:erc20:0xabc:7');
  });
  it('外部转入（opened_entry_id=0）与周期未就绪的仓位不能写观点', () => {
    // 后端对这两类一律回 BIZ_POSITION_NOT_FOUND；前端先挡住，免得点了才知道。
    expect(opinionTargetOf(pos({opened_entry_id: 0}))).toBeUndefined();
    expect(opinionTargetOf(pos({cycle_status: 'pending'}))).toBeUndefined();
  });
});

describe('观点接口', () => {
  it('发观点：POST /v1/social/opinions，带 target 与幂等键', async () => {
    const f = stubFetch({code: 200, msg: 'ok', data: {opinion: {opinion_id: 3, latest_version: {version_id: 9, body: 'b'}}}});
    const r = await createOpinion('tok', {targetID: '56:erc20:0xabc:7', body: 'b', idempotencyKey: 'k1'});
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('/v1/social/opinions');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({target_type: 'POSITION', target_id: '56:erc20:0xabc:7', body: 'b', items: [], idempotency_key: 'k1'});
    expect(r.opinion.opinion_id).toBe(3);
  });

  it('编辑：PUT 带 base_version_id（后端据此判版本冲突）', async () => {
    const f = stubFetch({code: 200, msg: 'ok', data: {opinion: {opinion_id: 3, latest_version: {version_id: 10, body: 'c'}}}});
    await updateOpinion('tok', {opinionID: 3, baseVersionID: 9, body: 'c', idempotencyKey: 'k2'});
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('/v1/social/opinions/3');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toMatchObject({base_version_id: 9, body: 'c', idempotency_key: 'k2'});
  });

  it('按 target 查：没有观点（200100）回 null，不当失败', async () => {
    stubFetch({code: 200100, msg: 'opinion not found', error: 'BIZ_OPINION_NOT_FOUND'});
    expect(await getOpinionByTarget('tok', '56:erc20:0xabc:7')).toBeNull();
  });

  it('审查拦截（600100）的 rule_id 从 metadata 取出来 —— 它是「命中哪条」的唯一线索', async () => {
    stubFetch({code: 600100, msg: 'opinion blocked', error: 'BIZ_OPINION_BLOCKED', metadata: {rule_id: 'dyn-4'}, trace_id: 't'});
    const err = await createOpinion('tok', {targetID: 't', body: 'x', idempotencyKey: 'k'}).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(blockedRuleOf(err)).toBe('dyn-4');
    expect(blockedRuleOf(new ApiError('business', 420101, 'x'))).toBeUndefined();
  });
});
