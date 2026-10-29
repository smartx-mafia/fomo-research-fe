// 本地持久化：intent、幂等键、签名产物（fastswap-app.md §4 第 6 条、§7）。
//
// 契约要求「签名产物**先可靠保存**，再上报」，且超时 / 刷新后用**原来的**幂等键
// 恢复同一笔。只放内存的话，签完还没上报时刷新页面，那份签名就丢了，只能重签 ——
// 而那正是契约禁止的形状（同一个 revision 出现两份签名）。
//
// 存的东西：签名产物是「用户对一笔后端已有交易的签名」，不是私钥；按账户分桶，
// swap 的 outcome 到终态（轮询回 `poll_after_ms === null`）后清掉。
//
// localStorage 在隐私窗口、被清站点数据时可能不可用 —— 读写一律 try/catch，
// 不可用时退回进程内 Map，并由 `durable()` 告诉页面「这次刷新就会丢」。

import type {CreateIntent, ExecutionReport} from './wire';

export type SwapRecord = {
  client_intent_id: string;
  intent: CreateIntent;
  /** 建单的幂等键。建单超时就用它原样重发。 */
  create_key: string;
  /** 用户确认时能接受的最低到账（原子数）。 */
  accepted_min_out_raw: string | null;
  swap_id: string | null;
  /** 签名产物。存在即「已签」—— 之后只许上报它，不许重签。 */
  artifact: ExecutionReport | null;
  /** 上报的幂等键。回 `new_idempotency_key` 时才换。 */
  execution_key: string | null;
  /** 上报已经拿到一份服务端快照（不论 execution.status 是几）。 */
  reported: boolean;
  updated_at: string;
};

export type SwapStore = {
  list(): SwapRecord[];
  byIntent(clientIntentID: string): SwapRecord | undefined;
  bySwap(swapID: string): SwapRecord | undefined;
  put(rec: SwapRecord): void;
  remove(clientIntentID: string): void;
  /** true = 写进了 localStorage；false = 只在内存里，刷新就丢。 */
  durable(): boolean;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** `account` 是「环境 + 用户键」：两套环境的同名用户不是同一个人（见记忆里两套 Privy app 那条）。 */
export function createSwapStore(account: string, storage: StorageLike | null = defaultStorage()): SwapStore {
  const key = `harness.fastswap.${account}`;
  let memory: Record<string, SwapRecord> = {};
  let isDurable = storage !== null;

  const read = (): Record<string, SwapRecord> => {
    if (!storage) return memory;
    try {
      const raw = storage.getItem(key);
      return raw ? (JSON.parse(raw) as Record<string, SwapRecord>) : {};
    } catch {
      isDurable = false;
      return memory;
    }
  };
  const write = (all: Record<string, SwapRecord>) => {
    memory = all;
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify(all));
      isDurable = true;
    } catch {
      isDurable = false;
    }
  };

  return {
    list: () => Object.values(read()),
    byIntent: (cid) => read()[cid],
    bySwap: (sid) => Object.values(read()).find((r) => r.swap_id === sid),
    put: (rec) => write({...read(), [rec.client_intent_id]: {...rec, updated_at: new Date().toISOString()}}),
    remove: (cid) => {
      const all = read();
      delete all[cid];
      write(all);
    },
    durable: () => isDurable,
  };
}

// ---------------------------------------------------------------------------
// 签名锁（对齐会话 Q11）
// ---------------------------------------------------------------------------

const heldInProcess = new Set<string>();

export class LockBusyError extends Error {
  constructor(name: string) {
    super(`签名锁「${name}」被占用 —— 另一个标签页或另一次点击正在处理这笔，本次不签`);
    this.name = 'LockBusyError';
  }
}

type LockManagerLike = {
  request<T>(name: string, options: {ifAvailable: boolean}, cb: (lock: unknown) => Promise<T>): Promise<T>;
};

/**
 * 按「账户 + swap」原子地取锁，拿不到立即失败（不排队）。
 *
 * 用 Web Locks：同源的所有标签页共享同一把，React 的重复渲染、双击、双标签页都挡得住。
 * 多设备同时推进由服务端 `420605` 兜底，不在这里管。没有 Web Locks 的环境
 * （Node 测试）退回进程内集合。
 */
export async function withSwapLock<T>(
  name: string,
  fn: () => Promise<T>,
  locks: LockManagerLike | null = (globalThis.navigator as {locks?: LockManagerLike} | undefined)?.locks ?? null,
): Promise<T> {
  if (locks) {
    return locks.request(name, {ifAvailable: true}, async (lock) => {
      if (!lock) throw new LockBusyError(name);
      return fn();
    });
  }
  if (heldInProcess.has(name)) throw new LockBusyError(name);
  heldInProcess.add(name);
  try {
    return await fn();
  } finally {
    heldInProcess.delete(name);
  }
}
