// backend/src/services/research/collectors/sa-comments.collector.ts
import type { Collector, CollectionResult } from "./types.js";
import { fetchSAArticles, fetchSAComments } from "./sa-rapidapi.js";

const MAX_ARTICLES = 50;
const MAX_COMMENTS_PER_ARTICLE = 100;
const MAX_TOTAL_COMMENTS = 200; // cap total comments to keep Claude prompt reasonable
const LOOKBACK_DAYS = 90;
const CONCURRENCY = 3; // limit parallel API calls to avoid 429s

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

    type Article = {
      id: string;
      title: string;
      publishedAt: string;
      comments: Array<{ id: string; content: string; createdAt: string; likes: number }>;
    };
    const fetchArticle = async (article: (typeof articlesRaw)[number]): Promise<Article> => {
      let comments: Article["comments"] = [];
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
    };

    // Fetch comments in article order with a small worker pool, and stop once
    // the articles so far hold MAX_TOTAL_COMMENTS: the cap below keeps
    // comments in article order, so later articles would contribute nothing.
    // In-flight articles count at their listed commentCount; if the real
    // counts fall short, the outer loop resumes where it stopped. Articles
    // never fetched are still listed, with no comments, exactly as before.
    const fetched: Article[] = [];
    const capped = (n: number) => Math.min(n, MAX_COMMENTS_PER_ARTICLE);
    let completedComments = 0;
    let inFlightEstimate = 0;
    let next = 0;
    const worker = async () => {
      while (next < articlesRaw.length && completedComments + inFlightEstimate < MAX_TOTAL_COMMENTS) {
        const i = next++;
        const estimate = capped(articlesRaw[i].attributes.commentCount ?? 0);
        inFlightEstimate += estimate;
        fetched[i] = await fetchArticle(articlesRaw[i]);
        inFlightEstimate -= estimate;
        completedComments += capped(fetched[i].comments.length);
      }
    };
    while (next < articlesRaw.length && completedComments < MAX_TOTAL_COMMENTS) {
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    }
    const articles: Article[] = articlesRaw.map((article, i) => fetched[i] ?? {
      id: article.id,
      title: article.attributes.title,
      publishedAt: article.attributes.publishOn,
      comments: [],
    });

    // Cap total comments to keep Claude prompt size reasonable.
    // Prioritize articles with more likes (higher engagement = better signal).
    let totalComments = 0;
    for (const article of articles) {
      // Sort comments within each article by likes (most liked first)
      article.comments.sort((a, b) => b.likes - a.likes);

      const remaining = MAX_TOTAL_COMMENTS - totalComments;
      if (remaining <= 0) {
        article.comments = [];
      } else if (article.comments.length > remaining) {
        article.comments = article.comments.slice(0, remaining);
      }
      totalComments += article.comments.length;
    }
    console.log(`[sa_comments] ${symbol}: collected ${articles.length} articles, ${totalComments} comments (capped at ${MAX_TOTAL_COMMENTS})`);

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
