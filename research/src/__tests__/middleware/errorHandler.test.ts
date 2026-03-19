import { describe, it, expect, vi, beforeEach } from "vitest";
import { z, ZodError } from "zod";
import type { Request, Response, NextFunction } from "express";
import { errorHandler } from "../../middleware/errorHandler.js";
import { AppError, NotFoundError, BadRequestError } from "../../errors/AppError.js";

function createMockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

const mockReq = {} as Request;
const mockNext = vi.fn() as NextFunction;

describe("errorHandler", () => {
  let res: Response;

  beforeEach(() => {
    res = createMockRes();
    vi.clearAllMocks();
  });

  it("handles ZodError with 400 status", () => {
    let error: ZodError;
    try {
      z.object({ name: z.string() }).parse({ name: 123 });
      throw new Error("should not reach");
    } catch (err) {
      error = err as ZodError;
    }

    errorHandler(error!, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Validation failed",
        details: expect.objectContaining({
          name: expect.any(Array),
        }),
      })
    );
  });

  it("handles AppError with custom status code", () => {
    const error = new AppError("Bad thing", 422);

    errorHandler(error, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ error: "Bad thing" });
  });

  it("handles NotFoundError with 404 status", () => {
    const error = new NotFoundError("Ticker", "AAPL");

    errorHandler(error, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Ticker 'AAPL' not found" });
  });

  it("handles BadRequestError with 400 status", () => {
    const error = new BadRequestError("Invalid input");

    errorHandler(error, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid input" });
  });

  it("handles generic Error with 500 status", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("unexpected");

    errorHandler(error, mockReq, res, mockNext);

    expect(consoleSpy).toHaveBeenCalledWith("Unhandled error:", error);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });

    consoleSpy.mockRestore();
  });
});
