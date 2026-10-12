import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    setting: { findMany: vi.fn() },
    flexFetchLog: { create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../../db/index.js", () => ({ prisma: mockPrisma }));

vi.mock("../../services/import.service.js", () => ({
  importService: { importFlexQuery: vi.fn() },
}));

import { FlexWebService } from "../../services/flex-web.service.js";

const TOKEN = "secret-token-123";

/** Mimics what Node's fetch throws on a network-level failure. */
function networkError(cause: unknown): TypeError {
  return new TypeError("fetch failed", { cause });
}

describe("FlexWebService.fetchAndImport network failures", () => {
  beforeEach(() => {
    mockPrisma.setting.findMany.mockResolvedValue([
      { key: "flex.token", value: TOKEN },
      { key: "flex.queryId", value: "1234567" },
    ]);
    mockPrisma.flexFetchLog.create.mockResolvedValue({ id: "log-1" });
    mockPrisma.flexFetchLog.update.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the host and the DNS failure instead of a bare 'fetch failed'", async () => {
    const cause = Object.assign(
      new Error("getaddrinfo ENOTFOUND ndcdyn.interactivebrokers.com"),
      { code: "ENOTFOUND" },
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError(cause)));

    const result = await new FlexWebService().fetchAndImport("manual");

    expect(fetch).toHaveBeenCalledWith(
      `https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest?t=${TOKEN}&q=1234567&v=3`
    );
    expect(result.status).toBe("error");
    expect(result.error).toContain("ndcdyn.interactivebrokers.com");
    expect(result.error).toContain("ENOTFOUND");
    expect(result.error).toContain("DNS");
    expect(result.error).not.toContain(TOKEN);
    expect(mockPrisma.flexFetchLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "error", error: result.error }),
      }),
    );
  });

  it("reports the underlying cause for non-DNS network failures", async () => {
    const cause = Object.assign(
      new Error("connect ECONNREFUSED 23.44.215.114:443"),
      {
        code: "ECONNREFUSED",
      },
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(networkError(cause)));

    const result = await new FlexWebService().fetchAndImport("manual");

    expect(result.error).toContain("connect ECONNREFUSED 23.44.215.114:443");
    expect(result.error).not.toContain("DNS");
    expect(result.error).not.toContain(TOKEN);
  });
});
