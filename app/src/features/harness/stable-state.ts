/**
 * Polling endpoints return fresh object/array identities even when their payload did not
 * change. Replacing React state with those identities makes the whole Harness tree render
 * again, which is particularly expensive while the operator is typing or switching desks.
 *
 * Keep the previous identity when the wire payload is unchanged. These values are JSON wire
 * models (no functions, cycles, Map, or BigInt), so their serialized form is the relevant
 * equality contract here.
 */
export function keepPreviousWireValue<T>(previous: T, next: T): T {
  if (Object.is(previous, next)) return previous;
  return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}
