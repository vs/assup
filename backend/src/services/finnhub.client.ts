/**
 * Minimal Finnhub client for the earnings calendar.
 *
 * Polygon's /vX/reference/financials endpoint (previously used for earnings)
 * returns historical SEC filings, not upcoming earnings announcement dates.
 * Finnhub's /calendar/earnings returns actual announcement dates with
 * estimate/actual EPS and the BMO/AMC timing hint.
 *
 * Free tier: 60 calls/minute.
 *
 * The API key is resolved from the database setting `finnhub_api_key` first,
 * with FINNHUB_API_KEY env var as fallback, so it can be configured via the UI.
 */

import { prisma } from "../db/index.js";

const BASE_URL = "https://finnhub.io/api/v1";
const SETTINGS_KEY = "finnhub_api_key";

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

// ── API Key Management ───────────────────────────────────────────────

export async function getFinnhubApiKey(): Promise<string | null> {
  const setting = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
  if (setting && typeof setting.value === "string" && setting.value) {
    return setting.value;
  }
  return process.env.FINNHUB_API_KEY || null;
}

export async function setFinnhubApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("API key must not be empty");
  await prisma.setting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: trimmed },
    update: { value: trimmed },
  });
}

export async function deleteFinnhubApiKey(): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: SETTINGS_KEY } });
}

export async function isFinnhubConfigured(): Promise<boolean> {
  return (await getFinnhubApiKey()) !== null;
}

function maskKey(key: string): string {
  if (key.length <= 12) return "***";
  return key.slice(0, 8) + "..." + key.slice(-4);
}

export interface FinnhubApiKeyStatus {
  configured: boolean;
  source: "database" | "environment" | "none";
  maskedKey?: string;
}

export async function getFinnhubApiKeyStatus(): Promise<FinnhubApiKeyStatus> {
  const setting = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
  if (setting && typeof setting.value === "string" && setting.value) {
    return { configured: true, source: "database", maskedKey: maskKey(setting.value) };
  }
  const envKey = process.env.FINNHUB_API_KEY;
  if (envKey) {
    return { configured: true, source: "environment", maskedKey: maskKey(envKey) };
  }
  return { configured: false, source: "none" };
}

// ── Earnings Calendar ────────────────────────────────────────────────

export async function fetchFinnhubEarnings(
  symbol: string,
  from: string,
  to: string
): Promise<FinnhubEarningsEntry[]> {
  const apiKey = await getFinnhubApiKey();
  if (!apiKey) {
    throw new Error("Finnhub API key is not configured");
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

/**
 * Probe the Finnhub API with the currently configured key to verify it works.
 * Returns true on 2xx, false otherwise. Used by the UI "Test" button.
 */
export async function testFinnhubConnection(): Promise<{ ok: boolean; message?: string }> {
  const apiKey = await getFinnhubApiKey();
  if (!apiKey) return { ok: false, message: "No API key configured" };

  const today = new Date().toISOString().split("T")[0];
  const url = new URL(`${BASE_URL}/calendar/earnings`);
  url.searchParams.set("from", today);
  url.searchParams.set("to", today);
  url.searchParams.set("token", apiKey);

  try {
    const response = await globalThis.fetch(url.toString());
    if (response.ok) return { ok: true };
    return { ok: false, message: `HTTP ${response.status}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "request failed" };
  }
}
