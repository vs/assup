/**
 * Security Assignments API
 */

import { request } from "./client";
import type { SecurityAssignment } from "@assup/shared";

interface SecurityAssignmentCreateInput {
  symbol: string;
  conId?: number;
  secType?: string;
  assetClassId: string;
  source?: string;
}

interface SecurityAssignmentUpdateInput {
  assetClassId: string;
}

export const securityAssignmentsApi = {
  list: () => request<SecurityAssignment[]>("/api/security-assignments"),

  get: (symbol: string, secType = "STK") =>
    request<SecurityAssignment>(`/api/security-assignments/${symbol}?secType=${secType}`),

  create: (data: SecurityAssignmentCreateInput) =>
    request<SecurityAssignment>("/api/security-assignments", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: SecurityAssignmentUpdateInput) =>
    request<SecurityAssignment>(`/api/security-assignments/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/api/security-assignments/${id}`, { method: "DELETE" }),
};
