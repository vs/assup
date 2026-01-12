/**
 * Global error handling middleware for Express
 */

import { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { AppError, ValidationError } from "../errors/index.js";
import { formatZodError } from "./validate.js";

/**
 * Type guard for Prisma known request errors
 * Works across Prisma versions without importing internal types
 */
interface PrismaKnownError {
  name: "PrismaClientKnownRequestError";
  code: string;
  meta?: Record<string, unknown>;
}

function isPrismaKnownError(err: unknown): err is PrismaKnownError {
  return (
    err !== null &&
    typeof err === "object" &&
    "name" in err &&
    err.name === "PrismaClientKnownRequestError" &&
    "code" in err &&
    typeof (err as PrismaKnownError).code === "string"
  );
}

/**
 * Standard error response format
 */
interface ErrorResponse {
  error: string;
  details?: Record<string, string[]>;
  code?: string;
}

/**
 * Global error handler middleware
 * Handles various error types and sends appropriate HTTP responses
 */
export const errorHandler: ErrorRequestHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // Log all errors
  const isDev = process.env.NODE_ENV === "development";
  if (isDev) {
    console.error(`[${req.method}] ${req.path}:`, err);
  } else {
    console.error(`[${req.method}] ${req.path}: ${err.message}`);
  }

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const response: ErrorResponse = {
      error: "Validation failed",
      details: formatZodError(err),
    };
    res.status(400).json(response);
    return;
  }

  // Handle custom validation errors
  if (err instanceof ValidationError) {
    const response: ErrorResponse = {
      error: err.message,
      details: err.errors,
    };
    res.status(400).json(response);
    return;
  }

  // Handle Prisma errors
  if (isPrismaKnownError(err)) {
    const response = handlePrismaError(err);
    res.status(response.statusCode).json(response.body);
    return;
  }

  // Handle custom AppError instances
  if (err instanceof AppError) {
    const response: ErrorResponse = { error: err.message };
    res.status(err.statusCode).json(response);
    return;
  }

  // Handle unknown errors
  const response: ErrorResponse = {
    error: isDev ? err.message : "Internal server error",
  };
  res.status(500).json(response);
};

/**
 * Handle Prisma-specific errors and return appropriate response
 */
function handlePrismaError(err: PrismaKnownError): {
  statusCode: number;
  body: ErrorResponse;
} {
  switch (err.code) {
    case "P2025":
      // Record not found
      return {
        statusCode: 404,
        body: { error: "Resource not found", code: err.code },
      };

    case "P2002":
      // Unique constraint violation
      const target = (err.meta?.target as string[])?.join(", ") || "field";
      return {
        statusCode: 409,
        body: { error: `A record with this ${target} already exists`, code: err.code },
      };

    case "P2003":
      // Foreign key constraint violation
      return {
        statusCode: 400,
        body: { error: "Referenced resource does not exist", code: err.code },
      };

    case "P2014":
      // Required relation violation
      return {
        statusCode: 400,
        body: { error: "This operation would violate a required relation", code: err.code },
      };

    default:
      return {
        statusCode: 500,
        body: { error: "Database operation failed", code: err.code },
      };
  }
}
