import { Router } from "express";
import { execFile, spawn } from "node:child_process";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { getOAuthToken, getAuthStatus } from "../services/auth.service.js";

const router = Router();

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const mode = process.env.SYNTHESIZER_MODE || "claude-cli";
    const authStatus = await getAuthStatus();

    const env = { ...process.env };
    delete env.CLAUDECODE;

    // Inject stored OAuth token for the CLI test
    const oauthToken = await getOAuthToken();
    if (oauthToken) {
      env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
      delete env.ANTHROPIC_API_KEY;
    }

    // Check if the binary exists and get its version
    const version = await new Promise<string | null>((resolve) => {
      execFile("claude", ["--version"], { env, timeout: 5_000 }, (err, stdout) => {
        resolve(err ? null : stdout.trim());
      });
    });

    if (!version) {
      res.json({
        available: false,
        error: "Claude CLI binary not found or failed to execute",
        mode,
        keyConfigured: authStatus.configured,
        keySource: authStatus.source,
      });
      return;
    }

    // Skip CLI test if no auth is configured — it will always fail
    if (!authStatus.configured && !process.env.ANTHROPIC_API_KEY) {
      res.json({
        available: false,
        error: "No authentication configured. Save an OAuth token above, or set ANTHROPIC_API_KEY.",
        mode,
        version,
        keyConfigured: false,
        keySource: "none",
      });
      return;
    }

    // Use spawn with stdin pipe — CLI hangs without TTY when prompt is positional arg
    const result = await new Promise<{ available: boolean; error?: string }>((resolve) => {
      const child = spawn("claude", [
        "--print", "--output-format", "text",
        "--dangerously-skip-permissions", "--no-session-persistence",
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

      child.on("error", (e) => resolve({ available: false, error: e.message }));

      child.on("close", (code, signal) => {
        if (signal === "SIGTERM") {
          resolve({ available: false, error: "CLI timed out (60s)" });
        } else if (code !== 0) {
          const detail = [stderr, stdout].filter(Boolean).join("\n").trim();
          console.error(`[Claude Status] CLI test failed (exit ${code}):`, detail || "(no captured output)");
          resolve({ available: false, error: detail || "CLI failed (no captured output)" });
        } else {
          resolve({ available: true });
        }
      });

      child.stdin.on("error", () => {});
      child.stdin.write("respond with ok");
      child.stdin.end();
    });

    res.json({
      ...result,
      mode,
      version,
      keyConfigured: authStatus.configured,
      keySource: authStatus.source,
    });
  })
);

export default router;
