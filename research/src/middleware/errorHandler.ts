import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "../errors/AppError.js";
import { formatZodError } from "./validate.js";

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      details: formatZodError(err),
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2025":
        res.status(404).json({ error: "Record not found" });
        return;
      case "P2002":
        res.status(409).json({ error: "Record already exists" });
        return;
      case "P2003":
        res.status(400).json({ error: "Referenced record not found" });
        return;
    }
  }

  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
}
