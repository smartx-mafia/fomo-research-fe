/**
 * Runs at most one task and retains at most one pending task.
 *
 * Form edits can arrive much faster than a create/cancel round trip. A Promise `.then()` chain
 * retains every intermediate closure until the network catches up, even though only the newest
 * form value is useful. This runner deliberately coalesces those intermediate values.
 */
export class LatestTaskRunner {
  private pending: (() => Promise<void>) | null = null;
  private running = false;
  private idleWaiters: Array<() => void> = [];

  schedule(task: () => Promise<void>): void {
    this.pending = task;
    if (!this.running) void this.drain();
  }

  /** Test/diagnostic seam: resolves once both the active and latest pending task are gone. */
  idle(): Promise<void> {
    if (!this.running && !this.pending) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.pending) {
        const task = this.pending;
        this.pending = null;
        await task();
      }
    } finally {
      this.running = false;
      // schedule() can run between the loop condition and finally. Do not strand that task.
      if (this.pending) {
        void this.drain();
        return;
      }
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }
}
