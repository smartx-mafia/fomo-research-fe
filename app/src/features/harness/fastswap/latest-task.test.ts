import {describe, expect, it} from 'vitest';

import {LatestTaskRunner} from './latest-task';

describe('LatestTaskRunner', () => {
  it('keeps only the newest pending task while a slow task is running', async () => {
    const runner = new LatestTaskRunner();
    const seen: number[] = [];
    let release!: () => void;
    const slow = new Promise<void>((resolve) => { release = resolve; });

    runner.schedule(async () => {
      seen.push(1);
      await slow;
    });
    await Promise.resolve();

    for (let n = 2; n <= 1_000; n++) {
      runner.schedule(async () => { seen.push(n); });
    }
    release();
    await runner.idle();

    expect(seen).toEqual([1, 1_000]);
  });
});
