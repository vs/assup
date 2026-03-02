/**
 * Asset Classes API
 */

import { request } from "./client";
import type { AssetClass } from "@assup/shared";

interface AssetClassCreateInput {
  name: string;
  description?: string;
  color?: string;
}

interface AssetClassUpdateInput {
  name?: string;
  description?: string;
  color?: string;
}

export const assetClassesApi = {
  list: () => request<AssetClass[]>("/api/asset-classes"),

  get: (id: string) => request<AssetClass>(`/api/asset-classes/${id}`),

  create: (data: AssetClassCreateInput) =>
    request<AssetClass>("/api/asset-classes", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: AssetClassUpdateInput) =>
    request<AssetClass>(`/api/asset-classes/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/api/asset-classes/${id}`, { method: "DELETE" }),
};
