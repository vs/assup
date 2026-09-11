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
 * Error for IBKR connection issues (503)
 */
export class IBKRConnectionError extends AppError {
  constructor(message = "Not connected to TWS") {
    super(message, 503);
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

/**
 * Error for an order TWS refused or never confirmed (422)
 *
 * The request was well formed; the broker would not accept it. `twsCode` is the
 * IBKR error code when the failure came from an explicit TWS rejection, and
 * null when the order simply went unconfirmed.
 */
export class OrderRejectedError extends AppError {
  public readonly twsCode: number | null;

  constructor(message: string, twsCode: number | null = null) {
    super(message, 422);
    this.twsCode = twsCode;
  }
}
