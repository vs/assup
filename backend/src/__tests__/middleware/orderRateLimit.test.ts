import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { applyOrderRateLimits, createOrderLimiter } from "../../middleware/orderRateLimit.js";

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  const app = express();
  applyOrderRateLimits(app, createOrderLimiter());
  // Stand-in for the real routers: every route just succeeds.
  app.all("*", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function hit(method: string, path: string, times: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < times; i++) {
    const res = await fetch(`${baseUrl}${path}`, { method });
    statuses.push(res.status);
  }
  return statuses;
}

describe("applyOrderRateLimits", () => {
  it.each([
    ["POST", "/api/orders/place"],
    ["POST", "/api/orders/roll"],
    ["PUT", "/api/orders/123"],
    ["POST", "/api/iron-condor/order"],
    ["POST", "/api/iron-condor/single-order"],
    ["POST", "/api/spreads/close"],
  ])("limits %s %s to 10 requests per minute", async (method, path) => {
    const statuses = await hit(method, path, 11);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(statuses[10]).toBe(429);
  });

  it("shares one budget across all order routes", async () => {
    await hit("POST", "/api/orders/place", 5);
    await hit("POST", "/api/orders/roll", 5);
    expect(await hit("POST", "/api/iron-condor/single-order", 1)).toEqual([429]);
  });

  it.each([
    ["DELETE", "/api/orders/123"],
    ["POST", "/api/orders/roll-candidates"],
    ["POST", "/api/orders/quote"],
  ])("does not limit %s %s", async (method, path) => {
    const statuses = await hit(method, path, 15);
    expect(statuses).toEqual(Array(15).fill(200));
  });
});
