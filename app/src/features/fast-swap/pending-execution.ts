export type PendingExecution =
  | {actor: string; swapID: string; kind: 'solana'; signed: string; idempotencyKey: string; revision: string; intentHash: string; safeBroadcastBefore: string; savedAt: string; submissionState: 'signed_unsent' | 'submission_unknown'; signAttemptID?: string; recoveryAction?: string; retryAfterAt?: string; lastTraceID?: string}
  | {actor: string; swapID: string; kind: 'evm'; signatures: {request_id: string; signature: string}[]; idempotencyKey: string; revision: string; intentHash: string; safeBroadcastBefore: string; savedAt: string; submissionState: 'signed_unsent' | 'submission_unknown'; signAttemptID?: string; recoveryAction?: string; retryAfterAt?: string; lastTraceID?: string};

const DATABASE = 'smartx-fast-swap';
const STORE = 'pending-executions';
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is unavailable.')); return; }
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, {keyPath: 'actor'});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open Fast Swap recovery storage.'));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Fast Swap recovery transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Fast Swap recovery transaction was aborted.'));
  });
}

export async function writePendingExecution(value: PendingExecution): Promise<boolean> {
  let db: IDBDatabase | undefined;
  try {
    db = await open(); const transaction = db.transaction(STORE, 'readwrite'); transaction.objectStore(STORE).put(value); await complete(transaction); return true;
  } catch { return false; } finally { db?.close(); }
}

export async function readPendingExecution(actor: string): Promise<PendingExecution | null> {
  let db: IDBDatabase | undefined;
  try {
    db = await open(); const transaction = db.transaction(STORE, 'readonly'); const done = complete(transaction); const request = transaction.objectStore(STORE).get(actor);
    const value = await new Promise<unknown>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await done;
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    if (row.actor !== actor || typeof row.swapID !== 'string' || typeof row.idempotencyKey !== 'string' || typeof row.revision !== 'string' || typeof row.intentHash !== 'string' || typeof row.safeBroadcastBefore !== 'string' || !Number.isFinite(Date.parse(row.safeBroadcastBefore)) || typeof row.savedAt !== 'string' || !['signed_unsent', 'submission_unknown'].includes(String(row.submissionState))) return null;
    if (row.kind === 'solana' && typeof row.signed === 'string' && row.signed !== '') return row as PendingExecution;
    if (row.kind === 'evm' && Array.isArray(row.signatures) && row.signatures.every((item) => item && typeof item === 'object' && typeof (item as {request_id?: unknown}).request_id === 'string' && typeof (item as {signature?: unknown}).signature === 'string')) return row as PendingExecution;
    return null;
  } catch { return null; } finally { db?.close(); }
}

export async function clearPendingExecutionIfMatch(expected: Pick<PendingExecution, 'actor' | 'swapID' | 'idempotencyKey' | 'revision'>): Promise<boolean> {
  let db: IDBDatabase | undefined;
  try {
    db = await open();
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const request = store.get(expected.actor);
    const matched = await new Promise<boolean>((resolve, reject) => {
      request.onsuccess = () => {
        const row = request.result as Partial<PendingExecution> | undefined;
        const same = row?.actor === expected.actor && row.swapID === expected.swapID &&
          row.idempotencyKey === expected.idempotencyKey && row.revision === expected.revision;
        if (same) store.delete(expected.actor);
        resolve(same);
      };
      request.onerror = () => reject(request.error);
    });
    await complete(transaction);
    return matched;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}
