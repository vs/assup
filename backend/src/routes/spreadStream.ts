import { Router, Request, Response } from "express";
import { SpreadStreamSession } from "../services/spreadStream.service.js";

const router = Router();

// Track active sessions by client ID so reconnects release the old session's
// market data lines before the new session tries to reserve them.
const activeSessions = new Map<string, SpreadStreamSession>();

router.get("/stream", (req: Request, res: Response) => {
  const symbol = (req.query.symbol as string) ?? "SPX";
  const expiration = req.query.expiration as string | undefined;
  const clientId = (req.query.clientId as string) ?? req.ip ?? "default";

  // Optional: only subscribe to specific strikes (when chain is collapsed)
  const strikesParam = req.query.strikes as string | undefined;
  const onlyStrikes = strikesParam
    ? strikesParam.split(",").map(Number).filter(n => !isNaN(n))
    : undefined;

  // Optional: focus range for dense subscription (phase 2 after auto-select)
  const focusMin = req.query.focusMin ? Number(req.query.focusMin) : undefined;
  const focusMax = req.query.focusMax ? Number(req.query.focusMax) : undefined;

  // Optional: target deltas for smart scout → focus subscription
  const targetPutDelta = req.query.targetPutDelta ? Number(req.query.targetPutDelta) : undefined;
  const targetCallDelta = req.query.targetCallDelta ? Number(req.query.targetCallDelta) : undefined;
  const wingWidth = req.query.wingWidth ? Number(req.query.wingWidth) : undefined;
  const mode = req.query.mode as string | undefined;

  // Destroy previous session for this client before starting a new one.
  // This ensures market data lines are freed even if req.on("close") from
  // the old connection hasn't fired yet (common with rapid reconnects).
  const prev = activeSessions.get(clientId);
  if (prev) {
    prev.destroy();
    activeSessions.delete(clientId);
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const session = new SpreadStreamSession(res, symbol, expiration, onlyStrikes,
    focusMin != null && focusMax != null ? { min: focusMin, max: focusMax } : undefined,
    targetPutDelta, targetCallDelta, wingWidth, mode);
  activeSessions.set(clientId, session);
  session.start();

  req.on("close", () => {
    session.destroy();
    // Only remove if this is still the active session for this client
    if (activeSessions.get(clientId) === session) {
      activeSessions.delete(clientId);
    }
  });
});

export default router;
