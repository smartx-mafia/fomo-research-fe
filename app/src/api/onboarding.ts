/**
 * 引导判定 —— docs/contracts/onboarding.md。
 *
 * 冷启动只调一次 GET /v1/user/onboarding 就知道该弹哪个引导页：
 * items 按服务端定义的引导顺序返回，前端取**第一个** `should_prompt`
 * 为真的项弹即可；都不为真就什么都不弹。
 *
 * 三条硬性要求（onboarding.md「编码事实」）：
 * ① 一律真值判断（`if (item.should_prompt)`）—— 零值字段整个缺席，
 *    `=== false` 拿到的是 undefined，判断恒不成立。
 * ② 不要用 key 是否存在做版本探测。
 * ③ 不要自己算 should_prompt —— 规则归服务端（冷却期 / 灰度 / 新用户
 *    判定将来都会加在那边），自己算的客户端不会跟着变。
 */
import {call} from './envelope';

export type OnboardingItem = {
  /** 功能点码，非空字符串、永远存在。读到不认识的码跳过它，不要崩。 */
  feature: string;
  done?: boolean;
  skipped?: boolean;
  should_prompt?: boolean;
};

export type OnboardingState = {
  items: OnboardingItem[];
};

/** 在册的功能点码（顺序即引导顺序）。表会变长：新码到来时老版本只是不弹它。 */
export const ONBOARDING_FEATURES = ['invite', 'nickname', 'x_bind'] as const;
export type OnboardingFeature = (typeof ONBOARDING_FEATURES)[number];

export const ONBOARDING_FEATURE_LABELS: Record<string, string> = {
  invite: '邀请准入',
  nickname: '设置昵称',
  x_bind: '绑定 X（Twitter）账号',
};

/** GET /v1/user/onboarding —— 该弹哪个引导页（Required，豁免准入门禁）。 */
export function getOnboarding(bearer: string, signal?: AbortSignal) {
  return call<OnboardingState>('/v1/user/onboarding', {bearer, signal});
}

/**
 * POST /v1/user/onboarding/skip —— 记录「以后再说」。
 *
 * feature 必须取自上一步回包里的值，不要自己拼（未在册回 100121）。
 * 幂等、单向、没有撤销接口。回包是执行之后的新状态，不必再 GET。
 */
export function skipOnboarding(bearer: string, feature: string) {
  return call<OnboardingState>('/v1/user/onboarding/skip', {method: 'POST', bearer, body: {feature}});
}

/** 取第一个 should_prompt 为真的项；都不为真返回 null（什么都不弹）。 */
export function firstPrompt(items: OnboardingItem[]): OnboardingItem | null {
  for (const item of items) {
    if (item.should_prompt) return item;
  }
  return null;
}
