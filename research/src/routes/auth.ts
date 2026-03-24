import { Router } from "express";
import { spawn } from "node:child_process";
import { asyncHandler } from "../middleware/asyncHandler.js";
import {
  getAuthStatus,
  setOAuthToken,
  deleteOAuthToken,
} from "../services/auth.service.js";

const router = Router();

/**
 * GET /api/auth/status
 * Returns auth status (configured, source, masked token). Never exposes full token.
 */
router.get(
  "/status",
  asyncHandler(async (_req, res) => {
    const status = await getAuthStatus();
    res.json(status);
  })
);

/**
 * Runs a quick CLI test via spawn with stdin pipe.
 * The CLI hangs without TTY when prompt is passed as positional arg,
 * so we pipe through stdin (matching the synthesizer pattern).
 */
function testCli(env: NodeJS.ProcessEnv): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn("claude", [
      "--print",
      "--output-format", "text",
      "--dangerously-skip-permissions",
      "--no-session-persistence",
      "--max-turns", "1",
    ], {
      env,
      timeout: 60_000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

    child.on("error", (e) => {
      console.error(`[Auth] CLI spawn error:`, e.message);
      resolve({ ok: false, error: e.message });
    });

    child.on("close", (code, signal) => {
      if (signal === "SIGTERM") {
        console.error(`[Auth] CLI timed out`);
        resolve({ ok: false, error: "CLI timed out (60s)" });
      } else if (code !== 0) {
        const detail = [stderr, stdout].filter(Boolean).join("\n").trim();
        console.error(`[Auth] CLI failed (exit ${code}):`, detail || "(no output — error likely written to TTY)");
        resolve({ ok: false, error: detail || "CLI failed (no captured output)" });
      } else {
        resolve({ ok: true });
      }
    });

    child.stdin.on("error", () => {}); // Ignore EPIPE
    child.stdin.write("respond with ok");
    child.stdin.end();
  });
}

/**
 * PUT /api/auth/token
 * Validates token by spawning claude CLI, then stores in DB on success.
 */
router.put(
  "/token",
  asyncHandler(async (req, res) => {
    const { token } = req.body;
    if (!token || typeof token !== "string") {
      res.status(400).json({ error: "Token is required" });
      return;
    }

    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.ANTHROPIC_API_KEY;
    env.CLAUDE_CODE_OAUTH_TOKEN = token;

    const valid = await testCli(env);

    if (!valid.ok) {
      res.status(422).json({ error: "Token validation failed", detail: valid.error });
      return;
    }

    await setOAuthToken(token);
    const status = await getAuthStatus();
    res.json(status);
  })
);

/**
 * DELETE /api/auth/token
 * Removes DB-stored token.
 */
router.delete(
  "/token",
  asyncHandler(async (_req, res) => {
    await deleteOAuthToken();
    const status = await getAuthStatus();
    res.json(status);
  })
);

export default router;
