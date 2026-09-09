export function opinionAge(seconds: number, now: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(now)) return '';
  const elapsed = Math.max(0, Math.floor((now - seconds * 1000) / 1000));
  if (elapsed < 60) return 'now';
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)}h`;
  return `${Math.floor(elapsed / 86400)}d`;
}

export function opinionPnl(value?: string): {text: string; direction: 'up' | 'down' | 'flat'; label: string} {
  const number = value?.trim() ? Number(value) : NaN;
  if (!Number.isFinite(number)) return {text: '—', direction: 'flat', label: 'PnL unavailable'};
  const direction = number < 0 ? 'down' : number > 0 ? 'up' : 'flat';
  return {text: `${Math.abs(number).toFixed(2)}%`, direction, label: `${number < 0 ? '-' : number > 0 ? '+' : ''}${Math.abs(number).toFixed(2)}%`};
}
