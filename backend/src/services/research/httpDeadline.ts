/**
 * Deadline for outbound research HTTP calls (Polygon, SEC EDGAR, Seeking Alpha).
 *
 * Node's fetch only gives up after undici's 5-minute header/body defaults, and
 * the SEC and Seeking Alpha helpers retry on top of that. A single silent
 * upstream could therefore park a collector — and with it the whole report
 * pipeline — for tens of minutes. Every research fetch carries this signal.
 */
export function researchHttpTimeoutMs(): number {
  return Number(process.env.RESEARCH_HTTP_TIMEOUT_MS ?? 20_000);
}

/** AbortSignal for a single outbound research request. */
export function researchHttpSignal(): AbortSignal {
  return AbortSignal.timeout(researchHttpTimeoutMs());
}
