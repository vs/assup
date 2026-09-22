import { prisma } from "../db.js";

const SETTINGS_KEY = "reddit_credentials";
const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const OAUTH_BASE = "https://oauth.reddit.com";
const REQUEST_TIMEOUT_MS = 15_000;

// Reddit's API rules require a descriptive User-Agent in the documented
// <platform>:<app id>:<version> (by /u/<user>) shape. Generic agents are
// throttled or blocked outright.
const USER_AGENT = "nodejs:assup-research:1.0 (by /u/assup)";

const SETUP_HINT =
  "Create a 'script' app at https://www.reddit.com/prefs/apps and save its " +
  "client ID and secret in Settings → Research.";

export interface RedditCredentials {
  clientId: string;
  clientSecret: string;
}

export interface RedditAuthStatus {
  configured: boolean;
  source: "database" | "environment" | "none";
  maskedClientId?: string;
}

/**
 * Reddit data could not be retrieved. Carries a message that tells the
 * operator what to do about it, since a blocked source is recorded on the
 * collection and shown in the UI rather than silently dropped.
 */
export class RedditUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedditUnavailableError";
  }
}

// ── Credentials ──────────────────────────────────────────────────────

function readStoredCredentials(value: unknown): RedditCredentials | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const { clientId, clientSecret } = record;
  if (typeof clientId !== "string" || typeof clientSecret !== "string") return null;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export async function getRedditCredentials(): Promise<RedditCredentials | null> {
  const setting = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
  const stored = readStoredCredentials(setting?.value);
  if (stored) return stored;

  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (clientId && clientSecret) return { clientId, clientSecret };

  return null;
}

export async function setRedditCredentials(creds: RedditCredentials): Promise<void> {
  const clientId = creds.clientId.trim();
  const clientSecret = creds.clientSecret.trim();
  if (!clientId) throw new Error("Client ID must not be empty");
  if (!clientSecret) throw new Error("Client secret must not be empty");

  await prisma.setting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: { clientId, clientSecret } },
    update: { value: { clientId, clientSecret } },
  });
  resetRedditTokenCache();
}

export async function deleteRedditCredentials(): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: SETTINGS_KEY } });
  resetRedditTokenCache();
}

function maskClientId(clientId: string): string {
  if (clientId.length <= 8) return "***";
  return clientId.slice(0, 4) + "..." + clientId.slice(-4);
}

export async function getRedditAuthStatus(): Promise<RedditAuthStatus> {
  const setting = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
  const stored = readStoredCredentials(setting?.value);
  if (stored) {
    return {
      configured: true,
      source: "database",
      maskedClientId: maskClientId(stored.clientId),
    };
  }

  const envId = process.env.REDDIT_CLIENT_ID;
  if (envId && process.env.REDDIT_CLIENT_SECRET) {
    return { configured: true, source: "environment", maskedClientId: maskClientId(envId) };
  }

  return { configured: false, source: "none" };
}

// ── Access token ─────────────────────────────────────────────────────

interface CachedToken {
  token: string;
  expiresAt: number;
  clientId: string;
}

let cachedToken: CachedToken | null = null;

/** Drop the cached access token. Exported for tests and credential changes. */
export function resetRedditTokenCache(): void {
  cachedToken = null;
}

async function fetchAccessToken(creds: RedditCredentials): Promise<CachedToken> {
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");

  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new RedditUnavailableError(
      `Could not reach Reddit to authenticate: ${(err as Error).message}`
    );
  }

  if (response.status === 401) {
    throw new RedditUnavailableError(
      `Reddit rejected the configured Reddit client ID/secret (HTTP 401). ${SETUP_HINT}`
    );
  }
  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 200);
    throw new RedditUnavailableError(
      `Reddit token request failed (HTTP ${response.status})${body ? `: ${body}` : ""}`
    );
  }

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!payload.access_token) {
    throw new RedditUnavailableError(
      "Reddit token response did not contain an access_token"
    );
  }

  // Refresh a minute early so an in-flight collection never uses a token
  // that expires mid-request.
  const ttlMs = (payload.expires_in ?? 3600) * 1000;
  return {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(ttlMs - 60_000, 0),
    clientId: creds.clientId,
  };
}

async function getAccessToken(): Promise<string> {
  const creds = await getRedditCredentials();
  if (!creds) {
    throw new RedditUnavailableError(
      `Reddit API credentials are not configured — Reddit closed its ` +
        `unauthenticated JSON endpoints, so a client ID and secret are ` +
        `required. ${SETUP_HINT}`
    );
  }

  if (
    cachedToken &&
    cachedToken.clientId === creds.clientId &&
    Date.now() < cachedToken.expiresAt
  ) {
    return cachedToken.token;
  }

  cachedToken = await fetchAccessToken(creds);
  return cachedToken.token;
}

// ── Requests ─────────────────────────────────────────────────────────

/**
 * Call an authenticated Reddit API endpoint.
 *
 * `path` is appended to the OAuth host, e.g. "/search?q=AAPL".
 * Throws RedditUnavailableError with an actionable message on any failure.
 */
export async function redditFetch(path: string): Promise<unknown> {
  const token = await getAccessToken();

  let response: Response;
  try {
    response = await fetch(`${OAUTH_BASE}${path}`, {
      headers: {
        Authorization: `bearer ${token}`,
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new RedditUnavailableError(
      `Could not reach the Reddit API: ${(err as Error).message}`
    );
  }

  if (response.status === 401) {
    // The token went stale early — drop it so the next attempt re-authenticates.
    resetRedditTokenCache();
    throw new RedditUnavailableError(
      `Reddit rejected the configured Reddit client ID/secret (HTTP 401). ${SETUP_HINT}`
    );
  }
  if (!response.ok) {
    throw new RedditUnavailableError(
      `Reddit API returned HTTP ${response.status} for ${path}`
    );
  }

  return response.json();
}
