import Anthropic from "@anthropic-ai/sdk";
import type { Analyzer, AnalysisOutput } from "./types.js";

const ANALYSIS_PROMPT = `You are analyzing Seeking Alpha article comments for investment insights.

Given the article titles and community comments below, extract:
1. Key investment ideas and arguments (bull and bear cases)
2. Consensus vs contrarian views
3. Specific catalysts and risks mentioned
4. Overall community sentiment

Respond with ONLY this JSON (no markdown fences):
{
  "signal": "bullish|bearish|neutral",
  "confidence": 0.0-1.0,
  "summary": "2-3 sentence summary of community sentiment and key ideas",
  "keyIdeas": [{"idea": "description", "stance": "bullish|bearish|neutral", "mentions": count}],
  "consensusView": "what most commenters agree on",
  "contrarianView": "notable dissenting opinions",
  "catalysts": ["upcoming events or drivers mentioned"],
  "risks": ["concerns or risks mentioned"]
}

Rules:
- Only cite ideas actually present in the comments
- Confidence: 0.3-0.5 for few comments, 0.5-0.8 for many with clear consensus, 0.8+ only for overwhelming agreement
- Be specific — quote or paraphrase actual comment content
- If comments are low quality or off-topic, reduce confidence`;

interface ArticleData {
  title?: string;
  comments?: Array<{ content?: string; likes?: number }>;
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

function extractJson(text: string): string {
  // Strip markdown fences
  const fenceStripped = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

  // Try the stripped text directly first
  try {
    JSON.parse(fenceStripped);
    return fenceStripped;
  } catch {
    // Fall through to extraction
  }

  // Extract the first top-level JSON object from within surrounding text
  const start = text.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in output");

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error("No complete JSON object found in output");
}

function buildUserPrompt(
  articles: ArticleData[],
  symbol: string,
  totalComments: number
): string {
  let prompt = `Analyze Seeking Alpha comments for ${symbol} (${totalComments} total comments across ${articles.length} articles).\n\n`;

  for (const article of articles) {
    const title = article.title || "Untitled";
    prompt += `### ${title}\n`;
    const comments = article.comments || [];
    if (comments.length === 0) {
      prompt += "(no comments)\n\n";
      continue;
    }
    for (const comment of comments) {
      const content = (comment.content || "").slice(0, 500);
      const likes = comment.likes ?? 0;
      prompt += `- [${likes} likes] ${content}\n`;
    }
    prompt += "\n";
  }

  prompt += "Provide your analysis as JSON.";
  return prompt;
}

export const saCommentsAnalyzer: Analyzer = {
  source: "sa_comments",

  async analyze(rawData: Record<string, unknown>): Promise<AnalysisOutput> {
    const articles = (rawData.articles as ArticleData[]) || [];
    const totalComments = (rawData.totalComments as number) || 0;
    const symbol = (rawData.symbol as string) || "UNKNOWN";

    if (totalComments === 0) {
      return {
        signal: "neutral",
        confidence: 0.1,
        summary: "No Seeking Alpha comments found for analysis.",
        details: { keyIdeas: [], catalysts: [], risks: [] },
      };
    }

    const anthropic = getClient();
    const userPrompt = buildUserPrompt(articles, symbol, totalComments);

    console.log(
      `[SA Comments Analyzer] Calling Claude for ${symbol} (${totalComments} comments across ${articles.length} articles)`
    );
    const start = Date.now();

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: ANALYSIS_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = message.content[0];
    const text = textBlock?.type === "text" ? textBlock.text : "";
    if (!text) {
      throw new Error(`[SA Comments Analyzer] Empty response from Claude for ${symbol}`);
    }
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(
      `[SA Comments Analyzer] Response for ${symbol} in ${elapsed}s (${text.length} chars, usage: ${message.usage.input_tokens}in/${message.usage.output_tokens}out)`
    );

    let parsed: any;
    try {
      parsed = JSON.parse(extractJson(text));
    } catch (e) {
      throw new Error(
        `[SA Comments Analyzer] Failed to parse Claude JSON for ${symbol}: ${(e as Error).message}. Raw text (first 500 chars): ${text.slice(0, 500)}`
      );
    }
    parsed = parsed as {
      signal?: string;
      confidence?: number;
      summary?: string;
      keyIdeas?: unknown[];
      consensusView?: string;
      contrarianView?: string;
      catalysts?: string[];
      risks?: string[];
    };

    const validSignals = ["bullish", "bearish", "neutral"];
    const signal = validSignals.includes(parsed.signal || "")
      ? (parsed.signal as "bullish" | "bearish" | "neutral")
      : "neutral";

    const confidence = typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.3;

    return {
      signal,
      confidence,
      summary: parsed.summary || "Unable to extract summary from analysis.",
      details: {
        keyIdeas: parsed.keyIdeas || [],
        consensusView: parsed.consensusView || null,
        contrarianView: parsed.contrarianView || null,
        catalysts: parsed.catalysts || [],
        risks: parsed.risks || [],
        articleCount: articles.length,
        totalComments,
      },
    };
  },
};
