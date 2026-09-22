import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { findUnique, upsert, deleteMany } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("../../../services/research/db.js", () => ({
  prisma: { setting: { findUnique, upsert, deleteMany } },
}));

import {
  getRedditCredentials,
  setRedditCredentials,
  getRedditAuthStatus,
  redditFetch,
  resetRedditTokenCache,
  RedditUnavailableError,
} from "../../../services/research/collectors/reddit-auth.js";

const CREDS = { clientId: "abcdefghijklmn", clientSecret: "secret-value-1234" };

function tokenResponse(expiresIn = 86400) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ access_token: "tok-123", expires_in: expiresIn }),
    text: () => Promise.resolve(""),
  } as Response;
}

describe("reddit-auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRedditTokenCache();
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    findUnique.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("credentials", () => {
    it("reads credentials from the database", async () => {
      findUnique.mockResolvedValue({ key: "reddit_credentials", value: CREDS });

      expect(await getRedditCredentials()).toEqual(CREDS);
    });

    it("falls back to environment variables", async () => {
      process.env.REDDIT_CLIENT_ID = "env-id";
      process.env.REDDIT_CLIENT_SECRET = "env-secret";

      expect(await getRedditCredentials()).toEqual({
        clientId: "env-id",
        clientSecret: "env-secret",
      });
    });

    it("returns null when neither source is configured", async () => {
      expect(await getRedditCredentials()).toBeNull();
    });

    it("rejects blank credentials on write", async () => {
      await expect(
        setRedditCredentials({ clientId: "  ", clientSecret: "x" })
      ).rejects.toThrow("Client ID must not be empty");
      expect(upsert).not.toHaveBeenCalled();
    });

    it("reports a masked status without leaking the secret", async () => {
      findUnique.mockResolvedValue({ key: "reddit_credentials", value: CREDS });

      const status = await getRedditAuthStatus();

      expect(status.configured).toBe(true);
      expect(status.source).toBe("database");
      expect(status.maskedClientId).toContain("...");
      expect(JSON.stringify(status)).not.toContain(CREDS.clientSecret);
    });

    it("reports not configured when nothing is set", async () => {
      expect(await getRedditAuthStatus()).toEqual({
        configured: false,
        source: "none",
      });
    });
  });

  describe("redditFetch", () => {
    beforeEach(() => {
      findUnique.mockResolvedValue({ key: "reddit_credentials", value: CREDS });
    });

    it("fails with an actionable error when no credentials are configured", async () => {
      findUnique.mockResolvedValue(null);

      await expect(redditFetch("/search?q=AAPL")).rejects.toThrow(
        /not configured/i
      );
      await expect(redditFetch("/search?q=AAPL")).rejects.toBeInstanceOf(
        RedditUnavailableError
      );
    });

    it("exchanges credentials for a token and calls the OAuth host", async () => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((input: string | URL | Request) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url.includes("access_token")) return Promise.resolve(tokenResponse());
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ data: { children: [] } }),
            text: () => Promise.resolve(""),
          } as Response);
        });

      await redditFetch("/search?q=AAPL");

      const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
      expect(String(tokenUrl)).toContain("/api/v1/access_token");
      expect((tokenInit as RequestInit).method).toBe("POST");
      expect((tokenInit as RequestInit).body).toContain("grant_type=client_credentials");
      const tokenHeaders = (tokenInit as RequestInit).headers as Record<string, string>;
      expect(tokenHeaders.Authorization).toBe(
        "Basic " + Buffer.from(`${CREDS.clientId}:${CREDS.clientSecret}`).toString("base64")
      );

      const [apiUrl, apiInit] = fetchMock.mock.calls[1];
      expect(String(apiUrl)).toBe("https://oauth.reddit.com/search?q=AAPL");
      const apiHeaders = (apiInit as RequestInit).headers as Record<string, string>;
      expect(apiHeaders.Authorization).toBe("bearer tok-123");
      expect(apiHeaders["User-Agent"]).toMatch(/assup/i);
    });

    it("reuses a cached token across calls", async () => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((input: string | URL | Request) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url.includes("access_token")) return Promise.resolve(tokenResponse());
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ data: { children: [] } }),
            text: () => Promise.resolve(""),
          } as Response);
        });

      await redditFetch("/search?q=AAPL");
      await redditFetch("/search?q=MSFT");

      const tokenCalls = fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes("access_token")
      );
      expect(tokenCalls).toHaveLength(1);
    });

    it("names the credentials when Reddit rejects them", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('{"message": "Unauthorized", "error": 401}'),
      } as Response);

      await expect(redditFetch("/search?q=AAPL")).rejects.toThrow(
        /rejected the configured Reddit client ID\/secret/i
      );
    });

    it("reports the status code when a search fails", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation((input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("access_token")) return Promise.resolve(tokenResponse());
        return Promise.resolve({
          ok: false,
          status: 429,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve("rate limited"),
        } as Response);
      });

      await expect(redditFetch("/search?q=AAPL")).rejects.toThrow(/429/);
    });
  });
});
