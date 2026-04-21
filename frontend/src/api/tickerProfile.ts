// frontend/src/api/tickerProfile.ts

import { request } from "./client";
import type {
  TickerProfileResponse,
  TickerProfileBatchResponse,
} from "@assup/shared";

export const tickerProfileApi = {
  getProfile: (symbol: string) =>
    request<TickerProfileResponse>(`/api/ticker-profile/${encodeURIComponent(symbol)}`),

  getBatchProfiles: (symbols: string[]) =>
    request<TickerProfileBatchResponse>("/api/ticker-profile/batch", {
      method: "POST",
      body: JSON.stringify({ symbols }),
    }),
};
