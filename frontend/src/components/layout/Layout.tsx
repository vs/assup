import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Settings } from "lucide-react";
import { Navigation } from "./Navigation";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSSEConnection } from "@/hooks/useSSE";
import { setDockBadge, isTauri } from "@/lib/tauriIntegration";

export function Layout() {
  const { connected } = useSSEConnection();
  const navigate = useNavigate();

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
          <div className="flex items-center gap-2">
            <ConnectionStatus />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <Settings className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => navigate("/settings")}>
                  <Settings className="h-4 w-4" />
                  Settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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
