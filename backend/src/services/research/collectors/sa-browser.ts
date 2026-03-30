import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { getSACredentials } from "../sa-auth.service.js";

const SESSION_DIR = path.join(process.cwd(), ".sa-session");
const STORAGE_STATE_PATH = path.join(SESSION_DIR, "storage-state.json");
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let ready = false;

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void closeBrowser(), IDLE_TIMEOUT_MS);
}

async function launchBrowser(): Promise<Page> {
  if (!browser || !browser.isConnected()) {
    const chromePath = process.env.CHROME_PATH;
    browser = await chromium.launch({
      // In Docker: use CHROME_PATH pointing to Alpine's chromium.
      // Locally: use system Chrome via channel.
      ...(chromePath
        ? { executablePath: chromePath }
        : { channel: "chrome" }),
      headless: true,
      args: [
        "--disable-blink-features=AutomationControlled",
        // Required when running as non-root inside containers
        "--no-sandbox",
        "--disable-setuid-sandbox",
        // Reduce resource usage in containers
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  }

  const ctxOptions: Parameters<Browser["newContext"]>[0] = {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
    timezoneId: "America/New_York",
  };

  if (existsSync(STORAGE_STATE_PATH)) {
    ctxOptions.storageState = STORAGE_STATE_PATH;
  }

  context = await browser.newContext(ctxOptions);
  page = await context.newPage();

  // Prevent navigator.webdriver from being detected
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  return page;
}

async function saveSession(): Promise<void> {
  if (!context) return;
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });
  await context.storageState({ path: STORAGE_STATE_PATH });
}

/**
 * Check whether a JSON response is a PerimeterX bot challenge
 * rather than real data.
 */
function isPxChallenge(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    "appId" in data &&
    "blockScript" in data
  );
}

/**
 * Try to log in to Seeking Alpha using credentials from env vars.
 * Skips silently when SA_EMAIL / SA_PASSWORD are not configured.
 */
async function tryLogin(p: Page): Promise<void> {
  const creds = await getSACredentials();
  if (!creds) {
    console.log("[sa-browser] No SA credentials configured, continuing as guest");
    return;
  }
  const { email, password } = creds;

  // Check if already logged in — SA shows a user-profile button when authenticated
  const loggedIn = await p.evaluate(() => {
    const el =
      document.querySelector("[data-test-id='user-nav']") ??
      document.querySelector("[data-test-id='user-profile-link']") ??
      document.querySelector("a[href='/account']");
    return Boolean(el);
  });

  if (loggedIn) {
    console.log("[sa-browser] Already logged in to Seeking Alpha");
    return;
  }

  console.log("[sa-browser] Logging in to Seeking Alpha…");

  await p.goto("https://seekingalpha.com/account/login", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  // Wait for the login form to appear
  await p.waitForTimeout(2000);

  // Fill credentials — try multiple selector strategies
  const emailInput =
    p.locator("input[type='email']").or(p.locator("input[name='email']")).or(p.getByPlaceholder(/email/i));
  const passwordInput =
    p.locator("input[type='password']").or(p.locator("input[name='password']")).or(p.getByPlaceholder(/password/i));

  await emailInput.first().fill(email);
  await passwordInput.first().fill(password);

  // Submit
  const submitBtn = p
    .getByRole("button", { name: /sign in/i })
    .or(p.locator("button[type='submit']"));
  await submitBtn.first().click();

  // Wait for navigation after login
  try {
    await p.waitForURL("**/seekingalpha.com/**", { timeout: 15_000 });
    await p.waitForTimeout(2000);
    console.log("[sa-browser] Logged in to Seeking Alpha");
  } catch {
    console.warn("[sa-browser] Login may have failed — continuing anyway");
  }
}

/**
 * Initialise the browser session: visit SA homepage for PX cookies,
 * then optionally log in.  Called once per browser lifecycle.
 */
async function initialise(p: Page): Promise<void> {
  await p.goto("https://seekingalpha.com/", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  // Give PerimeterX time to run its client-side JS and set cookies
  await p.waitForTimeout(3000);

  await tryLogin(p);
  await saveSession();
  ready = true;
}

async function ensurePage(): Promise<Page> {
  resetIdleTimer();

  if (page && !page.isClosed() && ready) return page;

  const p = await launchBrowser();
  await initialise(p);
  return p;
}

/**
 * Fetch a Seeking Alpha API URL via the headless browser and return
 * the parsed JSON.  Returns `null` on any failure.
 *
 * If a PerimeterX challenge is detected, the session is reset and
 * the request is retried once.
 */
export async function fetchSAJson(url: string, _retry = false): Promise<unknown | null> {
  const p = await ensurePage();

  try {
    const result = await p.evaluate(async (fetchUrl: string) => {
      try {
        const res = await fetch(fetchUrl);
        const text = await res.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return { __fetchError: true, status: res.status, body: text.slice(0, 200) };
        }
        if (!res.ok) return { __fetchError: true, status: res.status, parsed };
        return parsed;
      } catch (err) {
        return { __fetchError: true, message: String(err) };
      }
    }, url);

    // Detect PerimeterX challenge (can appear in both ok and error responses)
    if (isPxChallenge(result)) {
      if (!_retry) {
        console.warn("[sa-browser] PerimeterX challenge detected — reinitialising session…");
        await resetSession();
        return fetchSAJson(url, true);
      }
      console.warn("[sa-browser] PerimeterX challenge persists after retry");
      return null;
    }

    // Detect fetch-level error
    if (result && typeof result === "object" && "__fetchError" in result) {
      const err = result as Record<string, unknown>;

      // Check if the error body is a PX challenge
      if (err.parsed && isPxChallenge(err.parsed)) {
        if (!_retry) {
          console.warn("[sa-browser] PerimeterX challenge in error response — reinitialising session…");
          await resetSession();
          return fetchSAJson(url, true);
        }
        console.warn("[sa-browser] PerimeterX challenge persists after retry");
        return null;
      }

      // Regular HTTP error — don't reinitialise, just warn
      console.warn(`[sa-browser] Fetch error for ${url}: HTTP ${err.status ?? "unknown"}`);
      return null;
    }

    return result;
  } catch (err) {
    console.warn(`[sa-browser] evaluate() failed for ${url}:`, (err as Error).message);
    return null;
  }
}

/**
 * Close context (discards PX cookies) so the next call rebuilds
 * a fresh session.
 */
async function resetSession(): Promise<void> {
  ready = false;
  if (context) {
    await context.close().catch(() => {});
    context = null;
    page = null;
  }
  // Delete stored state so we don't reload stale cookies
  const { unlink } = await import("fs/promises");
  await unlink(STORAGE_STATE_PATH).catch(() => {});
}

/**
 * Fully shut down the browser.  Called on idle timeout and can be
 * invoked manually for graceful shutdown.
 */
export async function closeBrowser(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  ready = false;
  if (context) {
    await saveSession().catch(() => {});
    await context.close().catch(() => {});
    context = null;
    page = null;
  }
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}
