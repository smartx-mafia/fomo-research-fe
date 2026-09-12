/**
 * 客态用户公开资料 —— docs/contracts/settings.md §3.5（2026-09-12）。
 *
 * 看**别人**主页时的头部数据。与 /v1/profile（自己）刻意不同形：
 * 回包**只有六个字段**且恒在场（零值空串也在）—— 邮箱、Privy DID、语言、
 * 注册时间都不下发，不要按主态资料的形状解析。
 *
 * 两条 remark 硬约束（§3.5）：
 * ① remark 是附加字段，**不替代 nickname** —— nickname 恒是对方自己设的原值，
 *    展示名回退（remark → nickname → username → 缩写）由前端拼，两处要用
 *    不同样式（「我起的备注」vs「TA 自己的名字」）；
 * ② 只回你自己设的备注，读不到别人给你设的。
 *
 * 目标不可见（不存在/注销/封禁/未激活）一律 200102 BIZ_USER_NOT_FOUND，
 * 四种情况回包逐字节相同（有意不给探测口）—— 前端一律按「用户不存在」渲染。
 */
import {call} from './envelope';

export type UserPublicProfile = {
  /** 对外用户标识，回显路径参数（不是内部数字 id）。 */
  identifier: string;
  /** handle，未设置为空串。展示 @handle 用它。 */
  username?: string;
  /** 昵称原值，未设置为空串。服务端不代算展示名。 */
  nickname?: string;
  avatar_url?: string;
  /** 简介，未设置 / 已清空为空串。 */
  bio?: string;
  /** **你**给这个人设的备注名（客态页 Custom name），没设为空串。 */
  remark?: string;
};

/**
 * GET /v1/users/{user_identifier}/profile —— 需要登录（带自己的 JWT），
 * 查的目标只看路径。**回包随「谁在看」而变（remark）**，不能按 target 做公共缓存。
 * 列表面（搜索/榜单/详情页头部）没有客态资料接口，仍走 relations/batch。
 */
export function getUserPublicProfile(bearer: string, userIdentifier: string, signal?: AbortSignal) {
  return call<UserPublicProfile>(`/v1/users/${encodeURIComponent(userIdentifier)}/profile`, {
    bearer,
    signal,
  });
}
