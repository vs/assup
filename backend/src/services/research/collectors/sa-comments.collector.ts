// backend/src/services/research/collectors/sa-comments.collector.ts
import type { Collector, CollectionResult } from "./types.js";
import { fetchSAArticles, fetchSAComments } from "./sa-rapidapi.js";

const MAX_ARTICLES = 50;
const MAX_COMMENTS_PER_ARTICLE = 100;
const LOOKBACK_DAYS = 90;

export const saCommentsCollector: Collector = {
  source: "sa_comments",
  defaultSchedule: "0 18 * * 1-5",
  stalenessMinutes: 24 * 60,

  async collect(symbol: string): Promise<CollectionResult> {
    let articlesRaw: Array<{ id: string; attributes: { title: string; publishOn: string; commentCount: number } }> = [];
    try {
      const allArticles = await fetchSAArticles(symbol, LOOKBACK_DAYS);
      articlesRaw = allArticles
        .filter((a) => (a.attributes.commentCount ?? 1) > 0)
        .slice(0, MAX_ARTICLES);
      console.log(`[sa_comments] ${symbol}: ${allArticles.length} articles found, ${articlesRaw.length} with comments`);
    } catch (err) {
      console.warn(`[sa_comments] Failed to fetch articles for ${symbol}:`, (err as Error).message);
    }

    const articles = await Promise.all(
      articlesRaw.map(async (article) => {
        let comments: Array<{ id: string; content: string; createdAt: string; likes: number }> = [];
        try {
          const raw = await fetchSAComments(article.id);
          comments = raw.slice(0, MAX_COMMENTS_PER_ARTICLE).map((d) => ({
            id: d.id,
            content: stripHtml(d.attributes.content ?? ""),
            createdAt: d.attributes.createdOn,
            likes: d.attributes.likesCount,
          }));
        } catch {
          // skip comments for this article
        }

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

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}
