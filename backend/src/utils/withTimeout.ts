/**
 * Deadline wrapper for IBKR requests.
 *
 * IBApiNext resolves its request promises via lastValueFrom with no timeout, so
 * a request TWS never answers leaves the promise pending forever. TWS does this
 * silently for some contract queries (no data, no end marker, no error), which
 * would otherwise hang an HTTP handler or an SSE session indefinitely.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs: number,
): Promise<T> {
  let timer: NodeJS.Timeout;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}
