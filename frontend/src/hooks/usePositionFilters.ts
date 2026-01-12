import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";

const STORAGE_KEY = "assup-positions-filters";

export interface FilterState {
  assetClassId: string | null;
  includeOptions: boolean;
  optionsWeightMode: "notional" | "delta";
}

export const DEFAULT_FILTERS: FilterState = {
  assetClassId: null,
  includeOptions: true,
  optionsWeightMode: "notional",
};

function loadFiltersFromStorage(): FilterState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Migration from old showOptions to includeOptions
      if ("showOptions" in parsed && !("includeOptions" in parsed)) {
        parsed.includeOptions = parsed.showOptions;
        delete parsed.showOptions;
      }
      return { ...DEFAULT_FILTERS, ...parsed };
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_FILTERS;
}

function saveFiltersToStorage(filters: FilterState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
}

/**
 * Hook for managing position filters with URL params and localStorage sync
 */
export function usePositionFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialize filters from URL params, falling back to localStorage
  const [filters, setFiltersState] = useState<FilterState>(() => {
    const urlAssetClassId = searchParams.get("assetClassId");
    if (urlAssetClassId) {
      return { ...DEFAULT_FILTERS, assetClassId: urlAssetClassId };
    }
    return loadFiltersFromStorage();
  });

  // Sync filters with localStorage and URL
  useEffect(() => {
    saveFiltersToStorage(filters);

    // Update URL params when filter changes
    if (filters.assetClassId && filters.assetClassId !== "all") {
      setSearchParams({ assetClassId: filters.assetClassId }, { replace: true });
    } else {
      // Remove the param when cleared
      if (searchParams.has("assetClassId")) {
        setSearchParams({}, { replace: true });
      }
    }
  }, [filters, searchParams, setSearchParams]);

  const setFilters = useCallback((newFilters: FilterState) => {
    setFiltersState(newFilters);
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState(DEFAULT_FILTERS);
  }, []);

  const updateFilter = useCallback(<K extends keyof FilterState>(
    key: K,
    value: FilterState[K]
  ) => {
    setFiltersState((prev) => ({ ...prev, [key]: value }));
  }, []);

  return {
    filters,
    setFilters,
    resetFilters,
    updateFilter,
  };
}
