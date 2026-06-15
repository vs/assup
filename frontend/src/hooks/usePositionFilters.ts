import { useState, useCallback } from "react";

const STORAGE_KEY = "assup-positions-filters";

export interface FilterState {
  includeOptions: boolean;
  optionsWeightMode: "notional" | "delta";
}

export const DEFAULT_FILTERS: FilterState = {
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
 * Hook for managing position filters with localStorage sync
 */
export function usePositionFilters() {
  const [filters, setFiltersState] = useState<FilterState>(loadFiltersFromStorage);

  const setFilters = useCallback((newFilters: FilterState) => {
    setFiltersState(newFilters);
    saveFiltersToStorage(newFilters);
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState(DEFAULT_FILTERS);
    saveFiltersToStorage(DEFAULT_FILTERS);
  }, []);

  const updateFilter = useCallback(<K extends keyof FilterState>(
    key: K,
    value: FilterState[K]
  ) => {
    setFiltersState((prev) => {
      const next = { ...prev, [key]: value };
      saveFiltersToStorage(next);
      return next;
    });
  }, []);

  return {
    filters,
    setFilters,
    resetFilters,
    updateFilter,
  };
}
