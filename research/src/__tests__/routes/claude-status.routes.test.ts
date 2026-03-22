import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/test-app.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import claudeStatusRouter from "../../routes/claude-status.js";

const app = createTestApp({ path: "/api/claude-status", router: claudeStatusRouter });

describe("claude-status routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns available true when claude responds", async () => {
    vi.mocked(execFile).mockImplementation(
      (_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(null, "ok", "");
        return {} as any;
      }
    );

    const res = await request(app).get("/api/claude-status");

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.mode).toBeDefined();
  });

  it("returns available false when claude fails", async () => {
    vi.mocked(execFile).mockImplementation(
      (_cmd: any, _args: any, _opts: any, callback: any) => {
        callback(new Error("command not found"), "", "command not found");
        return {} as any;
      }
    );

    const res = await request(app).get("/api/claude-status");

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.error).toContain("command not found");
  });
});
