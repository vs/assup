import type { Collector, CollectionResult } from "./types.js";

const SA_BASE_URL = "https://seeking-alpha-finance.p.rapidapi.com/v1";
const MAX_ARTICLES = 3;
const MAX_COMMENTS_PER_ARTICLE = 20;

export const saCommentsCollector: Collector = {
  source: "sa_comments",
  defaultSchedule: "0 18 * * 1-5",
  stalenessMinutes: 24 * 60,

  async collect(symbol: string): Promise<CollectionResult> {
    const apiKey = process.env.SEEKING_ALPHA_API_KEY;
    if (!apiKey) {
      return {
        _tag: "skipped",
        source: "sa_comments",
        reason: "SEEKING_ALPHA_API_KEY not configured",
        expiresAt: new Date(Date.now() + this.stalenessMinutes * 60 * 1000),
      };
    }

    const headers = {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": "seeking-alpha-finance.p.rapidapi.com",
    };

    // Fetch articles for the symbol
    let articlesRaw: Array<{ id: string; attributes: { title: string; publishOn: string } }> = [];
    try {
      const res = await globalThis.fetch(
        `${SA_BASE_URL}/symbols/analysis?ticker_slug=${encodeURIComponent(symbol)}`,
        { headers },
      );
      if (!res.ok) {
        console.warn(`[sa_comments] Articles fetch failed for ${symbol}: HTTP ${res.status}`);
      } else {
        const json = (await res.json()) as { data?: Array<{ id: string; attributes: { title: string; publishOn: string } }> };
        articlesRaw = (json.data ?? []).slice(0, MAX_ARTICLES);
      }
    } catch (err) {
      console.warn(`[sa_comments] Failed to fetch articles for ${symbol}:`, (err as Error).message);
    }

    // Fetch comments for each article
    const articles = await Promise.all(
      articlesRaw.map(async (article) => {
        const commentIds = await fetchCommentIds(article.id, headers);
        const comments =
          commentIds.length > 0
            ? await fetchComments(article.id, commentIds.slice(0, MAX_COMMENTS_PER_ARTICLE), headers)
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

async function fetchCommentIds(
  articleId: string,
  headers: Record<string, string>,
): Promise<string[]> {
  try {
    const res = await globalThis.fetch(
      `${SA_BASE_URL}/articles/comment-maps?article_id=${encodeURIComponent(articleId)}`,
      { headers },
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
  headers: Record<string, string>,
): Promise<Array<{ id: string; content: string; createdAt: string; likes: number }>> {
  try {
    const res = await globalThis.fetch(
      `${SA_BASE_URL}/articles/comments?article_id=${encodeURIComponent(articleId)}&comment_ids=${commentIds.map(encodeURIComponent).join(",")}`,
      { headers },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<{ id: string; attributes: { content: string; created_at: string; likes_count: number } }> };
    return (json.data ?? []).map((d) => ({
        id: d.id,
        content: d.attributes.content,
        createdAt: d.attributes.created_at,
        likes: d.attributes.likes_count,
      }),
    );
  } catch (err) {
    console.warn(`[sa_comments] Failed to fetch comments for article ${articleId}:`, (err as Error).message);
    return [];
  }
}
