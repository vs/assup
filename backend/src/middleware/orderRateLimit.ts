/**
 * Rate limiting for endpoints that send orders to IBKR
 */

import type { Express, RequestHandler } from "express";
import rateLimit from "express-rate-limit";

/**
 * Stricter rate limiting for order placement to prevent accidental mass orders.
 * One limiter instance is shared by every order route, so they draw from a
 * single per-IP budget.
 */
export function createOrderLimiter(): RequestHandler {
  const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // limit each IP to 10 order placements per minute
    message: { error: "Too many order requests, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
  });
  // express-rate-limit is typed against a different @types/express copy than ours.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return limiter as any;
}

/**
 * Mount the order limiter on every route that places or modifies an order.
 * Must be called before the routers are mounted.
 *
 * Cancels (DELETE /api/orders/:id) are deliberately left out: they only
 * reduce exposure and must never be blocked by a burst of placements.
 */
export function applyOrderRateLimits(app: Express, limiter: RequestHandler = createOrderLimiter()): void {
  app.use("/api/orders/place", limiter);
  app.use("/api/orders/roll", limiter);
  app.put("/api/orders/:id", limiter);
  app.use("/api/iron-condor/order", limiter);
  app.use("/api/iron-condor/single-order", limiter);
  app.use("/api/spreads/close", limiter);
}
