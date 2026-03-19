import { describe, it, expect, vi, beforeEach } from "vitest";
import { z, ZodError } from "zod";
import type { Request, Response, NextFunction } from "express";
import { validate, formatZodError } from "../../middleware/validate.js";

function mockReq(overrides: Partial<Request> = {}): Request {
  return { body: {}, query: {}, params: {}, ...overrides } as unknown as Request;
}

const mockRes = {} as Response;

describe("validate", () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
  });

  it("passes valid body through", () => {
    const schema = z.object({ name: z.string() });
    const req = mockReq({ body: { name: "test" } });

    validate({ body: schema })(req, mockRes, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.body.name).toBe("test");
  });

  it("passes valid query through with coercion", () => {
    const schema = z.object({ page: z.coerce.number().int().min(1) });
    const req = mockReq({ query: { page: "3" } as any });

    validate({ query: schema })(req, mockRes, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.query).toEqual({ page: 3 });
  });

  it("passes valid params through", () => {
    const schema = z.object({ symbol: z.string().toUpperCase() });
    const req = mockReq({ params: { symbol: "aapl" } as any });

    validate({ params: schema })(req, mockRes, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.params.symbol).toBe("AAPL");
  });

  it("calls next(err) on invalid body", () => {
    const schema = z.object({ name: z.string() });
    const req = mockReq({ body: { name: 123 } });

    validate({ body: schema })(req, mockRes, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ZodError);
  });

  it("skips validation when no schema provided", () => {
    const req = mockReq({ body: { anything: true } });

    validate({})(req, mockRes, next);

    expect(next).toHaveBeenCalledWith();
  });
});

describe("formatZodError", () => {
  it("formats errors by path", () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    let error: ZodError;
    try {
      schema.parse({ name: 123, age: "abc" });
      throw new Error("should not reach");
    } catch (err) {
      error = err as ZodError;
    }

    const result = formatZodError(error!);

    expect(result).toHaveProperty("name");
    expect(result).toHaveProperty("age");
    expect(Array.isArray(result["name"])).toBe(true);
    expect(Array.isArray(result["age"])).toBe(true);
  });

  it("uses _root for top-level errors", () => {
    const schema = z.string();
    let error: ZodError;
    try {
      schema.parse(123);
      throw new Error("should not reach");
    } catch (err) {
      error = err as ZodError;
    }

    const result = formatZodError(error!);

    expect(result).toHaveProperty("_root");
    expect(Array.isArray(result["_root"])).toBe(true);
  });
});
