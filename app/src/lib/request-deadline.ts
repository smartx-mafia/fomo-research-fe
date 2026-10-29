export const LEADERBOARD_REQUEST_TIMEOUT_MS = 15_000;

export class RequestTimeoutError extends Error {
  constructor() {super('Request timed out'); this.name = 'TimeoutError';}
}

/** One budget includes headers, body consumption and any work/retries awaited
 * by operation. Canceling this request never changes another caller's signal. */
export async function withRequestDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  external?: AbortSignal,
  timeoutMs = LEADERBOARD_REQUEST_TIMEOUT_MS,
): Promise<T> {
  external?.throwIfAborted();
  const controller = new AbortController();
  let interrupt!: (reason: unknown) => void;
  const interrupted = new Promise<never>((_resolve, reject) => {interrupt = reject;});
  const stop = (reason: unknown) => {controller.abort(reason); interrupt(reason);};
  const cancel = () => stop(external!.reason);
  const timer = setTimeout(() => stop(new RequestTimeoutError()), timeoutMs);
  external?.addEventListener('abort', cancel, {once: true});
  try {
    const pending = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return operation(controller.signal);
    });
    const result = await Promise.race([pending, interrupted]);
    controller.signal.throwIfAborted();
    return result;
  } catch (error) {
    controller.abort(error);
    throw error;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', cancel);
  }
}
