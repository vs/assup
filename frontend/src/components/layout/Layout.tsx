import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { Navigation } from "./Navigation";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { useSSEConnection } from "@/hooks/useSSE";
import { setDockBadge, isTauri } from "@/lib/tauriIntegration";

export function Layout() {
  const { connected } = useSSEConnection();

  useEffect(() => {
    if (isTauri()) {
      setDockBadge(connected);
    }
  }, [connected]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-40">
        <div className="max-w-[1800px] mx-auto px-4 py-0 flex items-center justify-between w-full">
          <div className="flex items-center gap-4 md:gap-8">
            <a href="/" className="shrink-0">
              <img
                src="/assup_logo.svg"
                alt="Assup"
                className="h-16 md:h-28"
              />
            </a>
            <Navigation />
          </div>
          <ConnectionStatus />
        </div>
      </header>
      <main className="max-w-[1800px] mx-auto px-4 py-4 md:py-8 flex-1 w-full">
        <Outlet />
      </main>
      <footer className="border-t py-4 text-center text-xs text-muted-foreground">
        Assup - Asset Allocation Manager
      </footer>
    </div>
  );
}
