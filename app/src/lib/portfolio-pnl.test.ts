import {describe, expect, it} from 'vitest';
import {balanceForPnlTick, formatPnlTime, pnlGeometry, pnlTimeParts, pnlWindow} from './portfolio-pnl';
const now = Date.parse('2026-09-09T14:04:00Z');
const hour = 3600_000, day = 24 * hour;
const point = (at: number, value: string) => ({at: new Date(at).toISOString(), pnl_usd: value});
describe('East-eight PnL timeline', () => {
  it('matches total assets at the real sample instant and never substitutes a neighboring snapshot', () => {
    const at = '2026-09-09T14:00:00Z';
    const balance = {points: [{at, balance_usd: '0'}, {at: '2026-09-09T13:00:00Z', balance_usd: '9007199254740993.01'}], now_usd: '50', as_of: '2026-09-09T14:04:00Z', simulated: false};
    const tick = {at: '2026-09-09T22:00:00+08:00', atMs: Date.parse(at), x: 1, pnl_usd: '2'};
    expect(balanceForPnlTick(tick, balance)?.amount).toBe('0');
    expect(balanceForPnlTick({...tick, pnl_usd: undefined}, balance)?.amount).toBe('0');
    expect(balanceForPnlTick({...tick, sampleAt: '2026-09-09T13:00:00Z'}, balance)?.amount).toBe('9007199254740993.01');
    expect(balanceForPnlTick({...tick, sampleAt: '2026-09-09T13:30:00Z'}, balance)).toBeUndefined();
    expect(balanceForPnlTick({...tick, label: 'NOW'}, balance)).toEqual({amount: '50', at: balance.as_of});
    expect(balanceForPnlTick({...tick, label: 'NOW'}, {...balance, now_usd: undefined})).toBeUndefined();
  });
  it('formats UTC 14:04 as east-eight 22:04 consistently across dates', () => {
    expect(formatPnlTime('2026-09-09T14:04:00Z')).toBe('2026-09-09 22:04:00 UTC+08:00');
    expect(pnlTimeParts('2026-09-09T16:00:00Z')).toEqual({date: '2026-09-10', time: '00:00:00'});
  });
  it('maps the periods onto backend keys', () => {
    const pnl = {d1: {amount_usd: '1'}, d7: {amount_usd: '7'}, d30: {amount_usd: '30'}, all_usd: '100'};
    expect((['24H', '7D', '30D', 'All'] as const).map((p) => pnlWindow(pnl, p).amount)).toEqual(['1','7','30','100']);
  });
  it('renders 24 whole-hour nodes plus the separate current node at 22:04', () => {
    const anchor = Date.parse('2026-09-09T14:00:00Z');
    const curve = Array.from({length: 24}, (_, i) => point(anchor - i * hour, String(i)));
    const plot = pnlGeometry(curve, '24H', now, '99');
    expect(plot.ticks).toHaveLength(25);
    expect(plot.points).toHaveLength(25);
    expect(formatPnlTime(plot.ticks[0].at)).toBe('2026-09-08 23:00:00 UTC+08:00');
    expect(formatPnlTime(plot.ticks[23].at)).toBe('2026-09-09 22:00:00 UTC+08:00');
    expect(plot.ticks[24]).toMatchObject({label: 'NOW', atMs: now, pnl_usd: '99', x: 864});
    expect(plot.segments).toHaveLength(1);
  });
  it('renders 42 four-hour 7D nodes plus NOW', () => {
    const fourHour = 4 * hour;
    const anchor = Date.parse('2026-09-09T12:00:00Z');
    const curve = Array.from({length: 42}, (_, i) => point(anchor - i * fourHour, String(i)));
    const plot = pnlGeometry(curve, '7D', now, '42');
    expect(plot.ticks).toHaveLength(43);
    expect(plot.points).toHaveLength(43);
    expect(plot.ticks.slice(0, -1).every((p, index, ticks) => index === 0 || p.atMs - ticks[index - 1].atMs === fourHour)).toBe(true);
    expect(plot.ticks.slice(0, -1).every((p) => Number(pnlTimeParts(p.at).time.slice(0, 2)) % 4 === 0)).toBe(true);
    expect(plot.ticks.at(-1)?.atMs).toBe(now);
  });
  it('renders 30 historical east-eight midnights plus NOW', () => {
    const midnight = Date.parse('2026-09-08T16:00:00Z');
    const curve = Array.from({length: 30}, (_, i) => point(midnight - i * day, String(i)));
    const plot = pnlGeometry(curve, '30D', now, '42');
    expect(plot.ticks).toHaveLength(31);
    expect(plot.points).toHaveLength(31);
    expect(plot.ticks.slice(0, -1).every((p) => pnlTimeParts(p.at).time === '00:00:00')).toBe(true);
    expect(plot.ticks.at(-1)?.atMs).toBe(now);
  });
  it('keeps NOW separate when current time is exactly on an hour boundary', () => {
    const boundary = Date.parse('2026-09-09T14:00:00Z');
    const plot = pnlGeometry([point(boundary, '1')], '24H', boundary, '1');
    expect(plot.ticks).toHaveLength(25);
    expect(plot.ticks[23].atMs).toBe(boundary - hour);
    expect(plot.ticks[24].atMs).toBe(boundary);
  });
  it('preserves missing data and exposes older sample time without borrowing future values', () => {
    const previous = now - 10 * 60_000;
    const plot = pnlGeometry([point(previous, '4'), point(now + hour, '999')], '24H', now);
    expect(plot.ticks[23]).toMatchObject({pnl_usd: '4', sampleAt: new Date(previous).toISOString()});
    expect(plot.ticks[24].pnl_usd).toBeUndefined();
    expect(plot.ticks[0].pnl_usd).toBeUndefined();
    expect(plot.points.some((p) => p.pnl_usd === '999')).toBe(false);
    expect(pnlGeometry(undefined, '24H', now).points).toEqual([]);
  });
  it('fits all history and NOW without scrolling or dropping duplicates', () => {
    const curve = Array.from({length: 1000}, (_, i) => point(now - (i + 1) * day, String(i)));
    curve.push({...curve[0]});
    const plot = pnlGeometry(curve, 'All', now, '5');
    expect(plot.points).toHaveLength(1002);
    expect(plot.width).toBe(960);
    expect(plot.ticks.at(-1)?.label).toBe('NOW');
    expect(plot.ticks.every((p,i) => !i || p.atMs >= plot.ticks[i-1].atMs)).toBe(true);
  });
  it('retains exact tiny differences and zero values', () => {
    const anchor = Date.parse('2026-09-09T14:00:00Z');
    const plot = pnlGeometry([point(anchor, '9007199254740993.00000001')], '24H', now, '9007199254740993.00000002');
    expect(plot.points[0].y).toBe(236);
    expect(plot.points[1].y).toBe(26);
    expect(pnlGeometry([], '24H', now, '0').points[0].pnl_usd).toBe('0');
  });
});
