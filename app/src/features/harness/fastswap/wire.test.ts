import {describe, expect, it} from 'vitest';

import {
  AccountingStatus,
  ChainLegStatus,
  ExecutionStatus,
  Outcome,
  PreparationStatus,
  RelayStatus,
  accountingTone,
  chainLegTone,
  executionTone,
  outcomeTone,
  preparationTone,
  relayTone,
  type Tone,
} from './wire';

/**
 * 颜色表的守卫。它盯的是**每一个枚举值都被显式映射过**：
 * 漏一个分支不会报错，只表现为"那个状态永远是灰的"，而灰正好是「还没发生」
 * 的颜色 —— 于是一个已经走完、甚至已经出事的状态看起来像没开始。
 *
 * 期望值写死在这里，不从实现取：与实现同源的守卫会跟着实现一起漂。
 */
const EXPECT: {name: string; tone: (v: number | null | undefined) => Tone; want: Record<number, Tone>; enums: Record<string, number>}[] = [
  {
    name: '准备',
    tone: preparationTone,
    enums: PreparationStatus,
    want: {1: 'run', 2: 'ok', 3: 'run', 4: 'err', 5: 'err'},
  },
  {
    name: '执行',
    tone: executionTone,
    enums: ExecutionStatus,
    // 「结果未知」是黄不是红：它**不是失败**，禁止重签（契约 §5）。
    want: {1: 'off', 2: 'run', 3: 'ok', 4: 'run', 5: 'err'},
  },
  {name: '链腿', tone: chainLegTone, enums: ChainLegStatus, want: {1: 'off', 2: 'run', 3: 'ok', 4: 'err'}},
  // 退款中 / 已退款 / 失败都不是绿：钱可能回来了，但这笔交易没做成。
  {name: 'Relay', tone: relayTone, enums: RelayStatus, want: {1: 'run', 2: 'ok', 3: 'run', 4: 'err', 5: 'err'}},
  {name: '账务', tone: accountingTone, enums: AccountingStatus, want: {1: 'off', 2: 'ok', 3: 'run', 4: 'err'}},
  {
    name: '结局',
    tone: outcomeTone,
    enums: Outcome,
    // 只有「完成」是绿；「需人工核实」(9) 不是终态，但它是红。
    want: {1: 'run', 2: 'ok', 3: 'run', 4: 'off', 5: 'off', 6: 'err', 7: 'run', 8: 'err', 9: 'err'},
  },
];

describe('徽章颜色', () => {
  for (const g of EXPECT) {
    it(`${g.name}：每个枚举值都显式映射过`, () => {
      for (const v of Object.values(g.enums)) {
        expect(g.want[v], `${g.name} 的 ${v} 没有写进期望表`).toBeDefined();
        expect(g.tone(v), `${g.name} 的 ${v}`).toBe(g.want[v]);
      }
      // 期望表也不许多出实现里没有的值 —— 两边都会漂。
      expect(Object.keys(g.want).length).toBe(Object.values(g.enums).length);
    });

    it(`${g.name}：认不出的值给灰，不假装成功`, () => {
      expect(g.tone(0)).toBe('off');
      expect(g.tone(99)).toBe('off');
      expect(g.tone(null)).toBe('off');
      expect(g.tone(undefined)).toBe('off');
    });
  }

  it('只有「完成」一个结局是绿的', () => {
    const green = Object.values(Outcome).filter((v) => outcomeTone(v) === 'ok');
    expect(green).toEqual([Outcome.COMPLETED]);
  });
});
