/**
 * Modular API layer
 * Each domain has its own file with typed functions
 */

// Re-export the API client utilities
export { createApiError, isApiError, request, buildQuery } from "./client";
export type { ApiError } from "./client";

// Re-export domain APIs
export { assetClassesApi } from "./assetClasses";
export { allocationProfilesApi } from "./allocations";
export { positionsApi } from "./positions";
export { securityAssignmentsApi } from "./securityAssignments";
export { watchlistsApi } from "./watchlists";
export { ordersApi } from "./orders";
export { scannerApi } from "./scanner";
export { settingsApi } from "./settings";
export { historicalApi } from "./historical";
export { profitApi } from "./profit";
export { wheelApi } from "./wheel";
export { researchApi } from "./research";

// Combined api object for backward compatibility
import { assetClassesApi } from "./assetClasses";
import { allocationProfilesApi } from "./allocations";
import { positionsApi } from "./positions";
import { securityAssignmentsApi } from "./securityAssignments";
import { watchlistsApi } from "./watchlists";
import { ordersApi } from "./orders";
import { scannerApi } from "./scanner";
import { settingsApi } from "./settings";
import { historicalApi } from "./historical";
import { profitApi } from "./profit";
import { wheelApi } from "./wheel";
import { researchApi } from "./research";

export const api = {
  assetClasses: assetClassesApi,
  allocationProfiles: allocationProfilesApi,
  positions: positionsApi,
  securityAssignments: securityAssignmentsApi,
  watchlists: watchlistsApi,
  orders: ordersApi,
  scanner: scannerApi,
  settings: settingsApi,
  historical: historicalApi,
  profit: profitApi,
  wheel: wheelApi,
  research: researchApi,
};
