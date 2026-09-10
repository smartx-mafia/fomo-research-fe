/**
 * 配额文案与锁定判断（settings.md §2.1 / settings-integration.md §2.1）。
 *
 * remaining 为 0 时**缺席**（老版本）或**明确为 0**（2026-09-07 起）—— 两种
 * 形态都按「不能改」处理，`next_allowed_at` 显示倒计时。窗口是滚动的
 * （最近 24h / 最近 30 天），不是自然日。
 */
export type QuotaLike = {
  limit?: number;
  remaining?: number;
  next_allowed_at?: number | string;
  window_seconds?: number;
};

export function quotaText(quota: QuotaLike | undefined): string {
  if (!quota) return '';
  const window = quota.window_seconds ?? 0;
  const windowText = window >= 86400 * 20 ? '每 30 天' : '每 24 小时';
  const limit = quota.limit ?? 0;
  if (quota.remaining === undefined || quota.remaining === 0) {
    const next = Number(quota.next_allowed_at ?? 0);
    if (next > 0) {
      const hours = Math.max(1, Math.ceil((next * 1000 - Date.now()) / 3_600_000));
      return `${windowText}最多 ${limit} 次，次数已用完 · 还要等约 ${hours} 小时`;
    }
    return `${windowText}最多 ${limit} 次`;
  }
  return `${windowText}最多 ${limit} 次 · 还剩 ${quota.remaining} 次`;
}

/** remaining 缺席（=0）即当前不能改 —— 前端先置灰（settings-integration.md §2.3）。 */
export function quotaLocked(quota: {remaining?: number} | undefined): boolean {
  return !quota || quota.remaining === undefined || quota.remaining === 0;
}

/** 420104 / 420105 的 metadata.retry_after_seconds（字符串）→ 「还要等 X」文案。 */
export function retryAfterText(seconds: unknown): string {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 3600) return `还要等约 ${Math.ceil(n / 60)} 分钟`;
  return `还要等约 ${Math.ceil(n / 3600)} 小时`;
}
