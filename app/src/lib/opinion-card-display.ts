import {decimalSign, formatDecimalExact, marketValueFromBaseUnits} from './exact-decimal';

export function opinionCycleReturn(ratio?: string): {text: string; direction: 'up' | 'down' | 'flat'; label: string} {
  const sign = decimalSign(ratio);
  if (sign === undefined || ratio === undefined) return {text: '—', direction: 'flat', label: 'Cycle return unavailable'};
  const percent = marketValueFromBaseUnits('100', 0, ratio);
  const text = `${formatDecimalExact(percent.replace(/^-/, ''), 2)}%`;
  return {text, direction: sign < 0 ? 'down' : sign > 0 ? 'up' : 'flat', label: `Cycle return ${sign < 0 ? '-' : sign > 0 ? '+' : ''}${text}`};
}

export function opinionAge(seconds: number, now: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(now)) return '';
  const elapsed = Math.max(0, Math.floor((now - seconds * 1000) / 1000));
  if (elapsed < 60) return 'now';
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)}h`;
  return `${Math.floor(elapsed / 86400)}d`;
}
