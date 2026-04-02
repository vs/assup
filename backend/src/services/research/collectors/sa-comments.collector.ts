import { execFile } from "node:child_process";
import type { Collector, CollectionResult } from "./types.js";
import { fetchSAJson } from "./sa-browser.js";

const SA_API_BASE = "https://seekingalpha.com/api/v3";
const MAX_ARTICLES = 3;
const MAX_COMMENTS_PER_ARTICLE = 20;
const LOOKBACK_DAYS = 90;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

/**
 * Fetch JSON via wget. Node's fetch/https get PX-fingerprinted and blocked
 * by SA's PerimeterX, but wget uses a different TLS stack and passes.
 */
function fetchViaWget(url: string): Promise<unknown | null> {
  return new Promise((resolve) => {
    execFile(
      "wget",
      ["-q", "-O-", "--header", `User-Agent: ${UA}`, url],
      { timeout: 15_000 },
      (err, stdout) => {
        if (err) {
          console.warn(`[sa_comments] wget failed for ${url.slice(0, 80)}:`, err.message);
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          console.warn(`[sa_comments] wget returned non-JSON for ${url.slice(0, 80)}`);
          resolve(null);
        }
      },
    );
  });
}

/**
 * Fetch SA JSON with browser first, fall back to wget if PX blocked.
 * The /feed and /comments endpoints work without authentication.
 */
async function fetchSA(url: string): Promise<unknown | null> {
  const result = await fetchSAJson(url);
  if (result != null) return result;

  // Browser returned null (likely PX blocked) — fall back to wget
  console.log(`[sa_comments] Browser blocked, falling back to wget for ${url.slice(0, 80)}...`);
  return fetchViaWget(url);
}

export const saCommentsCollector: Collector = {
  source: "sa_comments",
  defaultSchedule: "0 18 * * 1-5",
  stalenessMinutes: 24 * 60,

  async collect(symbol: string): Promise<CollectionResult> {
    // Fetch recent articles for the symbol
    const since = Math.floor((Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000) / 1000);
    let articlesRaw: Array<{ id: string; attributes: { title: string; publishOn: string; commentCount: number } }> = [];
    try {
      const json = await fetchSA(
        `${SA_API_BASE}/feed?any_primary[]=${encodeURIComponent(symbol)}&filter[since]=${since}&include=author&models[]=Article&page[size]=10`,
      ) as { data?: Array<{ id: string; attributes: { title: string; publishOn: string; commentCount: number } }> } | null;

      if (json?.data) {
        // Only keep articles that have comments
        articlesRaw = json.data
          .filter((a) => a.attributes.commentCount > 0)
          .slice(0, MAX_ARTICLES);
        console.log(`[sa_comments] ${symbol}: ${json.data.length} articles found, ${articlesRaw.length} with comments`);
      } else {
        console.warn(`[sa_comments] ${symbol}: feed returned no articles`);
      }
    } catch (err) {
      console.warn(`[sa_comments] Failed to fetch articles for ${symbol}:`, (err as Error).message);
    }

    // Fetch comments for each article
    const articles = await Promise.all(
      articlesRaw.map(async (article) => {
        const commentIds = await fetchCommentIds(article.id);
        const comments =
          commentIds.length > 0
            ? await fetchComments(article.id, commentIds.slice(0, MAX_COMMENTS_PER_ARTICLE))
            : [];

        return {
          id: article.id,
          title: article.attributes.title,
          publishedAt: article.attributes.publishOn,
          comments,
        };
      }),
    );

    const totalComments = articles.reduce((sum, a) => sum + a.comments.length, 0);
    console.log(`[sa_comments] ${symbol}: collected ${articles.length} articles, ${totalComments} comments`);

    return {
      source: "sa_comments",
      data: {
        symbol,
        articles,
        articleCount: articles.length,
        totalComments,
        fetchedAt: new Date().toISOString(),
      },
      expiresAt: new Date(Date.now() + this.stalenessMinutes * 60 * 1000),
    };
  },
};

async function fetchCommentIds(articleId: string): Promise<string[]> {
  try {
    const json = await fetchSA(
      `${SA_API_BASE}/articles/${encodeURIComponent(articleId)}/comment_maps?include=user&lang=en&sort=-top_parent_id`,
    ) as { data?: Array<{ id: string }> } | null;

    return (json?.data ?? []).map((d) => d.id);
  } catch (err) {
    console.warn(`[sa_comments] Failed to fetch comment IDs for article ${articleId}:`, (err as Error).message);
    return [];
  }
}

async function fetchComments(
  articleId: string,
  commentIds: string[],
): Promise<Array<{ id: string; content: string; createdAt: string; likes: number }>> {
  try {
    const idsParam = commentIds.map((id) => `comment_ids[]=${encodeURIComponent(id)}`).join("&");
    const json = await fetchSA(
      `${SA_API_BASE}/articles/${encodeURIComponent(articleId)}/comments?${idsParam}&include=user&lang=en&sort=-top_parent_id`,
    ) as { data?: Array<{ id: string; attributes: { content: string; createdOn: string; likesCount: number } }> } | null;

    return (json?.data ?? []).map((d) => ({
      id: d.id,
      content: stripHtml(d.attributes.content),
      createdAt: d.attributes.createdOn,
      likes: d.attributes.likesCount,
    }));
  } catch (err) {
    console.warn(`[sa_comments] Failed to fetch comments for article ${articleId}:`, (err as Error).message);
    return [];
  }
}

/** Strip HTML tags from comment content */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}
