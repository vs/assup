import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import type { SparklinePoint } from "@/lib/api";

interface SparklineState {
  data: Record<string, SparklinePoint[]>;
  loading: Set<string>;
  errors: Set<string>;
}

export function useSparklines(symbols: string[]) {
  const [state, setState] = useState<SparklineState>({
    data: {},
    loading: new Set(),
    errors: new Set(),
  });

  const fetchedRef = useRef<Set<string>>(new Set());

  const fetchSparklines = useCallback(async (newSymbols: string[]) => {
    const toFetch = newSymbols.filter(
      (s) => s.length > 0 && !fetchedRef.current.has(s.toUpperCase())
    );

    if (toFetch.length === 0) return;

    // Mark as loading
    setState((prev) => ({
      ...prev,
      loading: new Set([...prev.loading, ...toFetch.map((s) => s.toUpperCase())]),
    }));

    // Mark as fetched to prevent duplicate requests
    toFetch.forEach((s) => fetchedRef.current.add(s.toUpperCase()));

    try {
      const results = await api.historical.getBatchSparklines(toFetch);

      setState((prev) => {
        const newData = { ...prev.data };
        const newLoading = new Set(prev.loading);
        const newErrors = new Set(prev.errors);

        for (const symbol of toFetch) {
          const upperSymbol = symbol.toUpperCase();
          newLoading.delete(upperSymbol);

          if (results[upperSymbol] && results[upperSymbol].length > 0) {
            newData[upperSymbol] = results[upperSymbol];
          } else {
            newErrors.add(upperSymbol);
          }
        }

        return { data: newData, loading: newLoading, errors: newErrors };
      });
    } catch (error) {
      console.error("Failed to fetch sparklines:", error);

      setState((prev) => {
        const newLoading = new Set(prev.loading);
        const newErrors = new Set(prev.errors);

        for (const symbol of toFetch) {
          const upperSymbol = symbol.toUpperCase();
          newLoading.delete(upperSymbol);
          newErrors.add(upperSymbol);
        }

        return { ...prev, loading: newLoading, errors: newErrors };
      });
    }
  }, []);

  useEffect(() => {
    if (symbols.length > 0) {
      fetchSparklines(symbols);
    }
  }, [symbols.join(","), fetchSparklines]);

  const getSparklineState = useCallback(
    (symbol: string) => {
      const upperSymbol = symbol.toUpperCase();
      return {
        data: state.data[upperSymbol] || [],
        loading: state.loading.has(upperSymbol),
        error: state.errors.has(upperSymbol),
      };
    },
    [state]
  );

  const reset = useCallback(() => {
    fetchedRef.current.clear();
    setState({ data: {}, loading: new Set(), errors: new Set() });
  }, []);

  return {
    getSparklineState,
    reset,
    isLoading: state.loading.size > 0,
  };
}
