import { prisma } from "../db.js";

const RAPIDAPI_HOST = "seeking-alpha.p.rapidapi.com";
const RAPIDAPI_BASE = `https://${RAPIDAPI_HOST}`;
const SETTINGS_KEY = "sa_rapidapi_key";

// ── API Key Management ───────────────────────────────────────────────

export async function getSAApiKey(): Promise<string | null> {
  const setting = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
  if (setting && typeof setting.value === "string" && setting.value) {
    return setting.value;
  }
  return process.env.SA_RAPIDAPI_KEY || null;
}

export async function setSAApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("API key must not be empty");
  await prisma.setting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: trimmed },
    update: { value: trimmed },
  });
}

export async function deleteSAApiKey(): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: SETTINGS_KEY } });
}

function maskKey(key: string): string {
  if (key.length <= 12) return "***";
  return key.slice(0, 8) + "..." + key.slice(-4);
}

export interface SAApiKeyStatus {
  configured: boolean;
  source: "database" | "environment" | "none";
  maskedKey?: string;
}

export async function getSAApiKeyStatus(): Promise<SAApiKeyStatus> {
  const setting = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
  if (setting && typeof setting.value === "string" && setting.value) {
    return { configured: true, source: "database", maskedKey: maskKey(setting.value) };
  }
  const envKey = process.env.SA_RAPIDAPI_KEY;
  if (envKey) {
    return { configured: true, source: "environment", maskedKey: maskKey(envKey) };
  }
  return { configured: false, source: "none" };
}

// ── HTTP Helper ──────────────────────────────────────────────────────

async function saFetch(path: string): Promise<unknown | null> {
  const apiKey = await getSAApiKey();
  if (!apiKey) {
    console.warn("[sa-rapidapi] No API key configured — skipping request");
    return null;
  }
  const url = `${RAPIDAPI_BASE}${path}`;
  try {
    const res = await fetch(url, {
      headers: {
        "x-RapidAPI-Key": apiKey,
        "x-RapidAPI-Host": RAPIDAPI_HOST,
      },
    });
    if (!res.ok) {
      console.warn(`[sa-rapidapi] HTTP ${res.status} for ${url.slice(0, 100)}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[sa-rapidapi] Fetch failed for ${url.slice(0, 100)}:`, (err as Error).message);
    return null;
  }
}

// ── Metrics ──────────────────────────────────────────────────────────

function flattenMetrics(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object") return null;
  const json = raw as {
    data?: Array<{
      attributes: { value: number };
      relationships: { metric_type: { data: { id: string } } };
    }>;
    included?: Array<{ id: string; type: string; attributes: { field: string } }>;
  };
  if (!json.data || !json.included) return null;

  const typeMap = new Map<string, string>();
  for (const inc of json.included) {
    if (inc.type === "metric_type") {
      typeMap.set(inc.id, inc.attributes.field);
    }
  }

  const result: Record<string, number> = {};
  for (const item of json.data) {
    const field = typeMap.get(item.relationships.metric_type.data.id);
    if (field) result[field] = item.attributes.value;
  }
  return Object.keys(result).length > 0 ? result : null;
}

export async function fetchSAMetrics(
  symbol: string,
  fields: string[],
): Promise<Record<string, number> | null> {
  const slug = symbol.toLowerCase();
  const raw = await saFetch(
    `/symbols/get-metrics?symbols=${encodeURIComponent(slug)}&fields=${fields.join(",")}`,
  );
  return flattenMetrics(raw);
}

// ── Articles & Comments (Direct SA API) ─────────────────────────────
// RapidAPI's /articles/v2/list?id= doesn't properly filter by ticker,
// so we use the direct SA API which correctly scopes via any_primary[].

const SA_DIRECT_BASE = "https://seekingalpha.com/api/v3";
const SA_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json",
};

export interface SAArticleRaw {
  id: string;
  attributes: { title: string; publishOn: string; commentCount: number };
}

export async function fetchSAArticles(
  symbol: string,
  lookbackDays: number,
): Promise<SAArticleRaw[]> {
  const since = Math.floor(
    (Date.now() - lookbackDays * 24 * 60 * 60 * 1000) / 1000,
  );
  try {
    const res = await fetch(
      `${SA_DIRECT_BASE}/feed?any_primary[]=${encodeURIComponent(symbol)}&filter[since]=${since}&include=author&models[]=Article&page[size]=10`,
      { headers: SA_HEADERS },
    );
    if (!res.ok) {
      console.warn(`[sa-rapidapi] Articles fetch failed for ${symbol}: HTTP ${res.status}`);
      return [];
    }
    const json = (await res.json()) as { data?: SAArticleRaw[] } | null;
    return json?.data ?? [];
  } catch (err) {
    console.warn(`[sa-rapidapi] Articles fetch error for ${symbol}:`, (err as Error).message);
    return [];
  }
}

export async function fetchSACommentIds(articleId: string): Promise<string[]> {
  try {
    const res = await fetch(
      `${SA_DIRECT_BASE}/articles/${encodeURIComponent(articleId)}/comment_maps?include=user&lang=en&sort=-top_parent_id`,
      { headers: SA_HEADERS },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<{ id: string }> } | null;
    return (json?.data ?? []).map((d) => d.id);
  } catch (err) {
    console.warn(`[sa-rapidapi] Comment IDs fetch error for article ${articleId}:`, (err as Error).message);
    return [];
  }
}

export interface SACommentRaw {
  id: string;
  attributes: { content: string; createdOn: string; likesCount: number };
}

export async function fetchSAComments(
  articleId: string,
  commentIds?: string[],
): Promise<SACommentRaw[]> {
  try {
    const idsParam = (commentIds ?? [])
      .map((id) => `comment_ids[]=${encodeURIComponent(id)}`)
      .join("&");
    const url = idsParam
      ? `${SA_DIRECT_BASE}/articles/${encodeURIComponent(articleId)}/comments?${idsParam}&include=user&lang=en&sort=-top_parent_id`
      : `${SA_DIRECT_BASE}/articles/${encodeURIComponent(articleId)}/comments?include=user&lang=en&sort=-top_parent_id`;
    const res = await fetch(url, { headers: SA_HEADERS });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: SACommentRaw[] } | null;
    return json?.data ?? [];
  } catch (err) {
    console.warn(`[sa-rapidapi] Comments fetch error for article ${articleId}:`, (err as Error).message);
    return [];
  }
}
