// frontend/src/components/common/TickerProfileProvider.tsx

import { createContext, useContext } from "react";
import { usePrefetchTickerProfiles } from "../../hooks/useTickerProfile";

interface TickerProfileContextValue {
  prefetch: (symbols: string[]) => Promise<void>;
}

const TickerProfileContext = createContext<TickerProfileContextValue>({
  prefetch: async () => {},
});

export function TickerProfileProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const prefetch = usePrefetchTickerProfiles();

  return (
    <TickerProfileContext.Provider value={{ prefetch }}>
      {children}
    </TickerProfileContext.Provider>
  );
}

export function useTickerProfileContext() {
  return useContext(TickerProfileContext);
}
