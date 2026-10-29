/**
 * 下单页「观点」台用的观点接口（契约：后端仓 docs/contracts/social.md）。
 *
 * 走 harness 自己的 `callWithToken`：路径前缀跟着顶栏的环境开关（本机 / 测试环境），请求带
 * x-request-id、进「过程」日志的计时钩子 —— 与下单同一条通道，切环境不会只切一半。产品页那份
 * `@/api/social-content` 绑的是构建期的 NEXT_PUBLIC_BUSINESS_API_BASE，跟不了这个开关。
 */
import {ApiError, callWithToken, type Position} from './api';

export type OpinionVersion = {version_id: number; version_no: number; body: string};
export type Opinion = {opinion_id: number; target_id: string; latest_version: OpinionVersion};
export type OpinionReply = {opinion: Opinion};

/** 审查拦截（发帖 / 编辑被本地词库或云二审拒绝）。 */
export const OPINION_BLOCKED = 600100;
/** 这个 target 上还没有观点。 */
export const OPINION_NOT_FOUND = 200100;

/**
 * 仓位 → 观点的 target_id：`chain_id:kind:地址:开仓分录 id`，与后端 `EncodePositionTargetID`
 * 同形。外部转入（opened_entry_id=0）与周期未就绪的仓位不能写观点 —— 后端一律回
 * BIZ_POSITION_NOT_FOUND，这里先挡住（与产品页 `positionTargetID` 同一判据）。
 */
export function opinionTargetOf(p: Position): string | undefined {
  const entry = Number(p.opened_entry_id);
  if (p.cycle_status !== 'ready' || !Number.isSafeInteger(entry) || entry < 1) return undefined;
  const {chain_id, kind, token_address} = p.asset;
  if (!kind || kind.includes(':') || !token_address || token_address.includes(':')) return undefined;
  return `${chain_id}:${kind}:${token_address}:${entry}`;
}

/** 按 target 读作者本人的观点；还没有就回 null（不是失败）。 */
export async function getOpinionByTarget(token: string, targetID: string): Promise<Opinion | null> {
  const q = new URLSearchParams({target_type: 'POSITION', target_id: targetID});
  try {
    const card = await callWithToken<{opinion: Opinion}>(token, `/v1/social/opinion-by-target?${q}`);
    return card.opinion;
  } catch (e) {
    if (e instanceof ApiError && e.code === OPINION_NOT_FOUND) return null;
    throw e;
  }
}

/** 发观点。幂等键每次提交新取：同键回放的是**首次**结论（被拒过的键重试永远是被拒）。 */
export function createOpinion(token: string, input: {targetID: string; body: string; idempotencyKey: string}) {
  return callWithToken<OpinionReply>(token, '/v1/social/opinions', {
    method: 'POST',
    body: JSON.stringify({
      target_type: 'POSITION',
      target_id: input.targetID,
      body: input.body,
      items: [],
      idempotency_key: input.idempotencyKey,
    }),
  });
}

/** 编辑：按当前词库重审全文；base_version_id 过期回 420101（版本冲突）。 */
export function updateOpinion(
  token: string,
  input: {opinionID: number; baseVersionID: number; body: string; idempotencyKey: string},
) {
  return callWithToken<OpinionReply>(token, `/v1/social/opinions/${input.opinionID}`, {
    method: 'PUT',
    body: JSON.stringify({base_version_id: input.baseVersionID, body: input.body, items: [], idempotency_key: input.idempotencyKey}),
  });
}

/** 删除整条观点（验完探针词后清理用）。 */
export function deleteOpinion(token: string, opinionID: number) {
  return callWithToken<unknown>(token, `/v1/social/opinions/${opinionID}`, {method: 'DELETE'});
}

/** 审查拦截的 rule_id；不是拦截回 undefined。 */
export function blockedRuleOf(e: unknown): string | undefined {
  if (!(e instanceof ApiError) || e.code !== OPINION_BLOCKED) return undefined;
  const id = e.metadata?.rule_id;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/** 每次提交一个新的幂等键。 */
export function newIdempotencyKey(): string {
  return `harness-op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
