/**
 * Custom application error classes for structured error handling
 */

/**
 * Base application error class
 * All custom errors should extend this class
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error for resource not found (404)
 */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    const message = identifier
      ? `${resource} with id '${identifier}' not found`
      : `${resource} not found`;
    super(message, 404);
  }
}

/**
 * Error for validation failures (400)
 */
export class ValidationError extends AppError {
  public readonly errors: Record<string, string[]>;

  constructor(errors: Record<string, string[]>, message = "Validation failed") {
    super(message, 400);
    this.errors = errors;
  }
}

/**
 * Error for duplicate/conflict resources (409)
 */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}

/**
 * Error for IBKR connection issues (503)
 */
export class IBKRConnectionError extends AppError {
  constructor(message = "Not connected to TWS") {
    super(message, 503);
  }
}

/**
 * Error for IBKR operation failures
 */
export class IBKROperationError extends AppError {
  public readonly ibkrCode?: number;

  constructor(message: string, ibkrCode?: number) {
    super(message, 502);
    this.ibkrCode = ibkrCode;
  }
}

/**
 * Error for unauthorized access (401)
 */
export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401);
  }
}

/**
 * Error for forbidden access (403)
 */
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, 403);
  }
}

/**
 * Error for bad requests (400)
 */
export class BadRequestError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}
