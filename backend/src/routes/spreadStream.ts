import { Router, Request, Response } from "express";
import { SpreadStreamSession } from "../services/spreadStream.service.js";

const router = Router();

router.get("/stream", (req: Request, res: Response) => {
  const symbol = (req.query.symbol as string) ?? "SPX";
  const expiration = req.query.expiration as string | undefined;

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const session = new SpreadStreamSession(res, symbol, expiration);
  session.start();

  req.on("close", () => {
    session.destroy();
  });
});

export default router;
