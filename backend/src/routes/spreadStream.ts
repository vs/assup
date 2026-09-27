import { Router, Request, Response } from "express";
import { SpreadStreamSession } from "../services/spreadStream.service.js";
import type { FocusRange, OptionSide } from "../services/spreadSubscriptionPlan.js";

const router = Router();

/**
 * Parse `focus=<min>:<max>[:<sides>]` params — one per region the client wants
 * streamed densely, e.g. `focus=7430:7730:P&focus=7610:7910:C` for an iron
 * condor's two wings. Sides default to the ones the spread mode needs.
 */
function parseFocusRanges(raw: unknown): FocusRange[] {
  if (raw == null) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values.map((value) => {
    const spec = String(value);
    const parts = spec.split(":");
    if (parts.length < 2 || parts.length > 3) {
      throw new Error(
        `Invalid focus range "${spec}": expected "<min>:<max>" or "<min>:<max>:<sides>", e.g. "7430:7730:P".`,
      );
    }
    const min = Number(parts[0]);
    const max = Number(parts[1]);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new Error(`Invalid focus range "${spec}": min and max must be numbers.`);
    }
    if (min > max) {
      throw new Error(`Invalid focus range "${spec}": min ${min} is above max ${max}.`);
    }
    if (parts.length === 2) return { min, max };

    const sides = [...new Set(parts[2].toUpperCase())] as OptionSide[];
    if (sides.length === 0 || sides.some((side) => side !== "P" && side !== "C")) {
      throw new Error(
        `Invalid focus range "${spec}": sides must be some of "P" and "C", e.g. "P", "C" or "PC".`,
      );
    }
    return { min, max, sides };
  });
}

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

  // Optional: focus ranges for dense subscription (phase 2 after auto-select)
  let focusRanges;
  try {
    focusRanges = parseFocusRanges(req.query.focus);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }

  // Optional: target deltas for smart scout → focus subscription
  const targetPutDelta = req.query.targetPutDelta ? Number(req.query.targetPutDelta) : undefined;
  const targetCallDelta = req.query.targetCallDelta ? Number(req.query.targetCallDelta) : undefined;
  const wingWidth = req.query.wingWidth ? Number(req.query.wingWidth) : undefined;
  const mode = req.query.mode as string | undefined;
  const strikeRangePct = req.query.strikeRangePct ? Number(req.query.strikeRangePct) : undefined;

  // Replace this client's previous session (a reconnect or re-parameterized
  // stream) so its leases are released before the new one sizes itself.
  // Sessions from other clients keep streaming: the QuoteHub shares lines for
  // contracts they have in common and enforces the overall line budget.
  const previous = activeSessions.get(clientId);
  if (previous) {
    previous.destroy();
    activeSessions.delete(clientId);
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const session = new SpreadStreamSession(res, symbol, expiration, onlyStrikes,
    focusRanges, targetPutDelta, targetCallDelta, wingWidth, mode, strikeRangePct);
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
