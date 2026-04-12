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

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

async function saFetch(path: string): Promise<unknown | null> {
  const apiKey = await getSAApiKey();
  if (!apiKey) {
    console.warn("[sa-rapidapi] No API key configured — skipping request");
    return null;
  }
  const url = `${RAPIDAPI_BASE}${path}`;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "x-RapidAPI-Key": apiKey,
          "x-RapidAPI-Host": RAPIDAPI_HOST,
        },
      });
      if ((res.status === 429 || res.status === 302) && attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * 2 ** attempt;
        console.warn(`[sa-rapidapi] HTTP ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
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
  return null;
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

// ── Articles & Comments ──────────────────────────────────────────────

export interface SAArticleRaw {
  id: string;
  attributes: { title: string; publishOn: string; commentCount: number };
}

/**
 * Fetch analysis articles for a ticker via RapidAPI.
 * Uses /analysis/v2/list which is the ticker-scoped analysis endpoint
 * (not /articles/v2/list which is a general/category endpoint).
 */
export async function fetchSAArticles(
  symbol: string,
  _lookbackDays: number,
): Promise<SAArticleRaw[]> {
  const slug = symbol.toLowerCase();
  const raw = await saFetch(
    `/analysis/v2/list?id=${encodeURIComponent(slug)}&size=40&number=1`,
  );
  const data = (raw as { data?: SAArticleRaw[] } | null)?.data ?? [];
  return data;
}

export interface SACommentRaw {
  id: string;
  attributes: { content: string; createdOn: string; likesCount: number };
}

export async function fetchSAComments(
  articleId: string,
): Promise<SACommentRaw[]> {
  // Step 1: Get comment list (metadata only — no content)
  const listRaw = await saFetch(
    `/comments/v2/list?id=${encodeURIComponent(articleId)}&sort=-top_parent_id&per_page=100`,
  );
  const listJson = listRaw as { data?: Array<{ id: string; attributes: Record<string, unknown> }> } | null;
  const commentList = listJson?.data ?? [];
  if (commentList.length === 0) return [];

  // Step 2: Fetch actual content via comments/get-contents (batches of 50)
  const results: SACommentRaw[] = [];
  for (let i = 0; i < commentList.length; i += 50) {
    const batch = commentList.slice(i, i + 50);
    const idsParam = batch.map((c) => `comment_ids=${encodeURIComponent(c.id)}`).join("&");
    const contentRaw = await saFetch(
      `/comments/get-contents?id=${encodeURIComponent(articleId)}&${idsParam}&sort=-top_parent_id`,
    );
    const contentJson = contentRaw as { data?: SACommentRaw[] } | null;
    if (contentJson?.data) {
      results.push(...contentJson.data);
    }
  }
  return results;
}
