import type { Collector, CollectionResult } from "./types.js";

const SA_API_BASE = "https://seekingalpha.com/api/v3";
const MAX_ARTICLES = 3;
const MAX_COMMENTS_PER_ARTICLE = 20;
const LOOKBACK_DAYS = 7;

const SA_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "application/json",
};

export const saCommentsCollector: Collector = {
  source: "sa_comments",
  defaultSchedule: "0 18 * * 1-5",
  stalenessMinutes: 24 * 60,

  async collect(symbol: string): Promise<CollectionResult> {
    // Fetch recent articles for the symbol
    const since = Math.floor((Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000) / 1000);
    let articlesRaw: Array<{ id: string; attributes: { title: string; publishOn: string; commentCount: number } }> = [];
    try {
      const res = await globalThis.fetch(
        `${SA_API_BASE}/feed?any_primary[]=${encodeURIComponent(symbol)}&filter[since]=${since}&include=author&models[]=Article&page[size]=${MAX_ARTICLES}`,
        { headers: SA_HEADERS },
      );
      if (!res.ok) {
        console.warn(`[sa_comments] Articles fetch failed for ${symbol}: HTTP ${res.status}`);
      } else {
        const json = (await res.json()) as { data?: Array<{ id: string; attributes: { title: string; publishOn: string; commentCount: number } }> };
        // Only keep articles that have comments
        articlesRaw = (json.data ?? [])
          .filter((a) => a.attributes.commentCount > 0)
          .slice(0, MAX_ARTICLES);
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
    const res = await globalThis.fetch(
      `${SA_API_BASE}/articles/${encodeURIComponent(articleId)}/comment_maps?include=user&lang=en&sort=-top_parent_id`,
      { headers: SA_HEADERS },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<{ id: string }> };
    return (json.data ?? []).map((d) => d.id);
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
    const res = await globalThis.fetch(
      `${SA_API_BASE}/articles/${encodeURIComponent(articleId)}/comments?${idsParam}&include=user&lang=en&sort=-top_parent_id`,
      { headers: SA_HEADERS },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<{ id: string; attributes: { content: string; createdOn: string; likesCount: number } }> };
    return (json.data ?? []).map((d) => ({
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
