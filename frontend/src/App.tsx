import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { DashboardPage } from "@/pages/DashboardPage";
import { AssetClassesPage } from "@/pages/AssetClassesPage";
import { PositionsPage } from "@/pages/PositionsPage";
import { WatchlistsPage } from "@/pages/WatchlistsPage";
import { OrdersPage } from "@/pages/OrdersPage";
import { ScannerPage } from "@/pages/ScannerPage";
import { LayoutDashboard, Layers, Briefcase, List, ShoppingCart, Search } from "lucide-react";

function NavItem({
  to,
  children,
  icon: Icon,
}: {
  to: string;
  children: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        }`
      }
    >
      <Icon className="h-4 w-4" />
      {children}
    </NavLink>
  );
}

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-background">
        <header className="border-b relative">
          <div className="container mx-auto px-4 py-0 flex items-center justify-between">
            <div className="flex items-center gap-8">
              <a href="/">
                <img src="/assup_logo.svg" alt="Assup" className="h-28" />
              </a>
              <nav className="flex items-center gap-1">
                <NavItem to="/" icon={LayoutDashboard}>
                  Dashboard
                </NavItem>
                <NavItem to="/positions" icon={Briefcase}>
                  Positions
                </NavItem>
                <NavItem to="/watchlists" icon={List}>
                  Watchlists
                </NavItem>
                <NavItem to="/orders" icon={ShoppingCart}>
                  Orders
                </NavItem>
                <NavItem to="/scanner" icon={Search}>
                  Scanner
                </NavItem>
                <NavItem to="/asset-classes" icon={Layers}>
                  Asset Classes
                </NavItem>
              </nav>
            </div>
            <ConnectionStatus />
          </div>
        </header>
        <main className="container mx-auto px-4 py-8">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/positions" element={<PositionsPage />} />
            <Route path="/watchlists" element={<WatchlistsPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/scanner" element={<ScannerPage />} />
            <Route path="/asset-classes" element={<AssetClassesPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
