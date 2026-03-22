import { Router } from "express";
import { execFile } from "node:child_process";
import { asyncHandler } from "../middleware/asyncHandler.js";

const router = Router();

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const mode = process.env.SYNTHESIZER_MODE || "claude-cli";

    const result = await new Promise<{ available: boolean; error?: string }>((resolve) => {
      const env = { ...process.env };
      delete env.CLAUDECODE;

      execFile(
        "claude",
        ["--print", "--output-format", "text", "--dangerously-skip-permissions", "--no-session-persistence", "--max-turns", "1", "respond with ok"],
        { env, timeout: 15_000 },
        (err, _stdout, stderr) => {
          if (err) {
            resolve({ available: false, error: stderr || err.message });
          } else {
            resolve({ available: true });
          }
        }
      );
    });

    res.json({ ...result, mode });
  })
);

export default router;
