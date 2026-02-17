/**
 * Base API client with error handling
 */

import { getApiBase } from "@/lib/apiConfig";

export interface ApiError {
  message: string;
  statusCode: number;
  details?: Record<string, string[]>;
}

export function createApiError(
  message: string,
  statusCode: number,
  details?: Record<string, string[]>
): ApiError & Error {
  const error = new Error(message) as ApiError & Error;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

export function isApiError(error: unknown): error is ApiError & Error {
  return error instanceof Error && "statusCode" in error;
}

/**
 * Make a typed API request with error handling
 */
export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: response.statusText }));
    throw createApiError(
      errorBody.error || "Request failed",
      response.status,
      errorBody.details
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

/**
 * Build query string from params object
 */
export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams.set(key, String(value));
    }
  }
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}
