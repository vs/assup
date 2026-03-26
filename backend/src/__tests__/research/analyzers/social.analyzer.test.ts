import { describe, it, expect } from "vitest";
import { socialAnalyzer } from "../../../services/research/analyzers/social.analyzer.js";

function makePost(text: string, source: "reddit" | "stocktwits" = "reddit") {
  return {
    source,
    title: null,
    body: text,
    timestamp: new Date().toISOString(),
    score: 10,
    comments: 5,
    subreddit: "wallstreetbets",
    sentiment: null,
    url: null,
  };
}

describe("socialAnalyzer", () => {
  it("returns neutral for empty posts", async () => {
    const result = await socialAnalyzer.analyze({ posts: [], totalMentionCount: 0 });
    expect(result.signal).toBe("neutral");
    expect(result.confidence).toBe(0.1);
    expect(result.summary).toContain("No social media mentions");
  });

  it("returns neutral for null posts", async () => {
    const result = await socialAnalyzer.analyze({});
    expect(result.signal).toBe("neutral");
  });

  it("signals bullish for positive sentiment posts", async () => {
    const posts = [
      makePost("This stock is bullish, buy the dip! Moon rocket breakout!"),
      makePost("Strong growth, undervalued, long calls!"),
      makePost("Squeeze rally coming, buy buy buy!"),
    ];
    const result = await socialAnalyzer.analyze({
      posts, totalMentionCount: 3, redditMentionCount: 3, stocktwitsMentionCount: 0,
    });
    expect(result.signal).toBe("bullish");
  });

  it("signals bearish for negative sentiment posts", async () => {
    const posts = [
      makePost("Crash dump sell! Overvalued bubble!"),
      makePost("Short puts bearish tank drill!"),
      makePost("Weak miss loss baghold!"),
    ];
    const result = await socialAnalyzer.analyze({
      posts, totalMentionCount: 3, redditMentionCount: 3, stocktwitsMentionCount: 0,
    });
    expect(result.signal).toBe("bearish");
  });

  it("signals neutral for mixed sentiment", async () => {
    const posts = [
      makePost("bullish moon"),
      makePost("bearish crash"),
    ];
    const result = await socialAnalyzer.analyze({
      posts, totalMentionCount: 2, redditMentionCount: 2, stocktwitsMentionCount: 0,
    });
    expect(result.signal).toBe("neutral");
  });

  it("returns 0 sentiment for posts with no sentiment words", async () => {
    const posts = [makePost("The company reported earnings today.")];
    const result = await socialAnalyzer.analyze({
      posts, totalMentionCount: 1, redditMentionCount: 1, stocktwitsMentionCount: 0,
    });
    const details = result.details as Record<string, unknown>;
    expect(details.sentimentScore).toBe(0);
  });

  it("confidence scales with mention count", async () => {
    const post = makePost("bullish moon rocket");
    const few = await socialAnalyzer.analyze({
      posts: [post], totalMentionCount: 1, redditMentionCount: 1, stocktwitsMentionCount: 0,
    });
    const many = await socialAnalyzer.analyze({
      posts: Array(25).fill(post), totalMentionCount: 25, redditMentionCount: 25, stocktwitsMentionCount: 0,
    });
    expect(many.confidence).toBeGreaterThan(few.confidence);
  });

  it("includes top 5 posts in details", async () => {
    const posts = Array.from({ length: 10 }, (_, i) => makePost(`bullish post ${i}`));
    const result = await socialAnalyzer.analyze({
      posts, totalMentionCount: 10, redditMentionCount: 10, stocktwitsMentionCount: 0,
    });
    const details = result.details as Record<string, unknown>;
    expect((details.topPosts as unknown[]).length).toBeLessThanOrEqual(5);
  });
});
