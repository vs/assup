import { Router, Request, Response } from "express";
import { SpreadStreamSession } from "../services/spreadStream.service.js";

const router = Router();

router.get("/stream", (req: Request, res: Response) => {
  const symbol = (req.query.symbol as string) ?? "SPX";
  const expiration = req.query.expiration as string | undefined;
  // Optional: only subscribe to specific strikes (when chain is collapsed)
  const strikesParam = req.query.strikes as string | undefined;
  const onlyStrikes = strikesParam
    ? strikesParam.split(",").map(Number).filter(n => !isNaN(n))
    : undefined;

  // Optional: focus range for dense subscription (phase 2 after auto-select)
  const focusMin = req.query.focusMin ? Number(req.query.focusMin) : undefined;
  const focusMax = req.query.focusMax ? Number(req.query.focusMax) : undefined;

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const session = new SpreadStreamSession(res, symbol, expiration, onlyStrikes,
    focusMin != null && focusMax != null ? { min: focusMin, max: focusMax } : undefined);
  session.start();

  req.on("close", () => {
    session.destroy();
  });
});

export default router;
