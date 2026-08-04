/**
 * Minimal Finnhub client for the earnings calendar.
 *
 * Polygon's /vX/reference/financials endpoint (previously used for earnings)
 * returns historical SEC filings, not upcoming earnings announcement dates.
 * Finnhub's /calendar/earnings returns actual announcement dates with
 * estimate/actual EPS and the BMO/AMC timing hint.
 *
 * Free tier: 60 calls/minute.
 */

const BASE_URL = "https://finnhub.io/api/v1";

export interface FinnhubEarningsEntry {
  date: string; // YYYY-MM-DD announcement date
  epsActual: number | null;
  epsEstimate: number | null;
  hour: "bmo" | "amc" | "dmh" | "";
  quarter: number;
  revenueActual: number | null;
  revenueEstimate: number | null;
  symbol: string;
  year: number;
}

export function isFinnhubConfigured(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY);
}

export async function fetchFinnhubEarnings(
  symbol: string,
  from: string,
  to: string
): Promise<FinnhubEarningsEntry[]> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    throw new Error("FINNHUB_API_KEY is not set");
  }

  const url = new URL(`${BASE_URL}/calendar/earnings`);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("token", apiKey);

  const response = await globalThis.fetch(url.toString());
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Finnhub API error ${response.status}: ${body}`);
  }
  const data = (await response.json()) as {
    earningsCalendar?: FinnhubEarningsEntry[];
  };
  return data.earningsCalendar ?? [];
}
