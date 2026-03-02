/**
 * Error handling utilities for consistent error type checking across the codebase.
 */

/**
 * Extract error message from an unknown error value.
 */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'object' && err !== null) {
    const e = err as Record<string, unknown>;
    if (typeof e.message === 'string') {
      return e.message;
    }
  }
  return String(err);
}

/**
 * Extract error code from an unknown error value.
 */
function getErrorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null) {
    const e = err as Record<string, unknown>;
    if (typeof e.code === 'string') {
      return e.code;
    }
  }
  return undefined;
}

/**
 * Check if error indicates the account doesn't support positions.
 * This is common for certain IBKR account types.
 */
function isPositionNotSupportedError(err: unknown): boolean {
  return getErrorMessage(err).includes('does not support positions');
}

/**
 * Check if error is a timeout error.
 */
function isTimeoutError(err: unknown): boolean {
  return getErrorCode(err) === 'timeout';
}

/**
 * Check if error should be ignored during position fetching.
 * Some account types don't support positions, and timeouts are expected during market data requests.
 */
export function isIgnorablePositionError(err: unknown): boolean {
  return isPositionNotSupportedError(err) || isTimeoutError(err);
}
