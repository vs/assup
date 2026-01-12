/**
 * Allocation Profiles API
 */

import { request } from "./client";
import type { AllocationProfile, AllocationTargetInput } from "@assup/shared";

export interface AllocationProfileCreateInput {
  name: string;
  isActive?: boolean;
  targets?: AllocationTargetInput[];
}

export interface AllocationProfileUpdateInput {
  name?: string;
  isActive?: boolean;
  targets?: AllocationTargetInput[];
}

export const allocationProfilesApi = {
  list: () => request<AllocationProfile[]>("/api/allocation-profiles"),

  getActive: () => request<AllocationProfile>("/api/allocation-profiles/active"),

  get: (id: string) => request<AllocationProfile>(`/api/allocation-profiles/${id}`),

  create: (data: AllocationProfileCreateInput) =>
    request<AllocationProfile>("/api/allocation-profiles", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: AllocationProfileUpdateInput) =>
    request<AllocationProfile>(`/api/allocation-profiles/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  activate: (id: string) =>
    request<AllocationProfile>(`/api/allocation-profiles/${id}/activate`, {
      method: "POST",
    }),

  delete: (id: string) =>
    request<void>(`/api/allocation-profiles/${id}`, { method: "DELETE" }),
};
