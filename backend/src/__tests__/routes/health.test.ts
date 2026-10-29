import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("../../db/index.js", () => ({
  prisma: { assetClass: { count: vi.fn() } },
}));

vi.mock("../../services/ibkr.js", () => ({
  ibkrService: { getStatus: vi.fn() },
}));

import healthRouter from "../../routes/health.js";
import { prisma } from "../../db/index.js";
import { ibkrService } from "../../services/ibkr.js";
import { createTestApp } from "../research/helpers/test-app.js";

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  (prisma.assetClass.count as any).mockResolvedValue(4);
  server = createTestApp({ path: "/api/health", router: healthRouter }).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/health", () => {
  it("reports the TWS connection without the account id", async () => {
    (ibkrService.getStatus as any).mockReturnValue({
      connected: true,
      account: "U1234567",
      serverVersion: 176,
      serverConnectionTime: "20261029 10:00:00",
      error: null,
    });

    const res = await fetch(`${baseUrl}/api/health`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.database).toEqual({ connected: true, assetClasses: 4 });
    expect(body.ibkr).toEqual({ connected: true, serverVersion: 176, error: null });
    expect(JSON.stringify(body)).not.toContain("U1234567");
  });

  it("stays 200 when TWS is disconnected so the backend is still discoverable", async () => {
    (ibkrService.getStatus as any).mockReturnValue({
      connected: false,
      account: null,
      serverVersion: null,
      serverConnectionTime: null,
      error: "connect ECONNREFUSED 127.0.0.1:7496",
    });

    const res = await fetch(`${baseUrl}/api/health`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ibkr).toEqual({
      connected: false,
      serverVersion: null,
      error: "connect ECONNREFUSED 127.0.0.1:7496",
    });
  });

  it("fails when the database is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    (prisma.assetClass.count as any).mockRejectedValue(new Error("Can't reach database server"));

    const res = await fetch(`${baseUrl}/api/health`);

    expect(res.status).toBe(500);
  });
});
