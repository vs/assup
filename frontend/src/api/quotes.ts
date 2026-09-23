/**
 * Quotes API — live quote subscriptions for this SSE client.
 */

import { request } from "./client";

export const quotesApi = {
  /** Replace the full set of contracts streamed to this SSE client */
  setSubscriptions: (clientId: string, conIds: number[]) =>
    request<{ clients: number; contracts: number }>("/api/quotes/subscriptions", {
      method: "POST",
      body: JSON.stringify({ clientId, conIds }),
    }),
};
