import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { MacroAnalysis } from "@assup/shared";
import { researchApi } from "@/api";
import { useMacroUpdates } from "@/hooks/useSSE";

interface MacroContextValue {
  macro: MacroAnalysis | null;
  refresh: () => void;
  refreshing: boolean;
}

const MacroContext = createContext<MacroContextValue>({
  macro: null,
  refresh: () => {},
  refreshing: false,
});

export function MacroProvider({ children }: { children: React.ReactNode }) {
  const [macro, setMacro] = useState<MacroAnalysis | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(() => {
    setRefreshing(true);
    researchApi
      .refreshMacro()
      .then(setMacro)
      .catch((err) => console.error("Macro refresh failed:", err))
      .finally(() => setRefreshing(false));
  }, []);

  // Initial fetch from API
  useEffect(() => {
    researchApi
      .getMacro()
      .then(setMacro)
      // Live SSE updates can still fill the gauge in later.
      .catch((err) => console.error("Failed to load macro data:", err));
  }, []);

  // Live updates via SSE — merges live VIX/SPX into the current macro state
  useMacroUpdates((data) => {
    const update = data as MacroAnalysis;
    if (update?.details) {
      setMacro(update);
    }
  });

  return (
    <MacroContext.Provider value={{ macro, refresh, refreshing }}>
      {children}
    </MacroContext.Provider>
  );
}

export function useMacro() {
  return useContext(MacroContext);
}
