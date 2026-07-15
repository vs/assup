import { NavLink } from "react-router-dom";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Briefcase,
  Calendar,
  LayoutDashboard,
  List,
  Search,
  TrendingUp,
  RefreshCw,
  ArrowUpDown,
  Settings,
  Menu,
  X,
} from "lucide-react";
import { useActiveScanJobCount } from "@/hooks/useActiveScanJobCount";

interface NavItemProps {
  to: string;
  children: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
  badge?: React.ReactNode;
}

function NavItem({ to, children, icon: Icon, onClick, badge }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      onClick={onClick}
      className={({ isActive }) =>
        `relative flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        }`
      }
    >
      <Icon className="h-4 w-4" />
      {children}
      {badge}
    </NavLink>
  );
}

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/positions", label: "Positions", icon: Briefcase },
  { to: "/profit", label: "Profit", icon: TrendingUp },
  { to: "/analysis", label: "Watchlists", icon: List },
  { to: "/scanner", label: "Scanner", icon: Search },
  { to: "/wheel", label: "Wheel", icon: RefreshCw },
  { to: "/spreads", label: "Spreads", icon: ArrowUpDown },
  { to: "/calendar", label: "Calendar", icon: Calendar },
];

function ScanJobBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-bold text-white">
      {count}
    </span>
  );
}

export function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const activeScanJobCount = useActiveScanJobCount();

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const getBadge = (to: string) =>
    to === "/scanner" ? <ScanJobBadge count={activeScanJobCount} /> : undefined;

  return (
    <>
      {/* Desktop Navigation */}
      <nav className="hidden lg:flex items-center gap-1">
        {navItems.map((item) => (
          <NavItem key={item.to} to={item.to} icon={item.icon} badge={getBadge(item.to)}>
            {item.label}
          </NavItem>
        ))}
        <NavItem to="/settings" icon={Settings}>
          Settings
        </NavItem>
      </nav>

      {/* Mobile Menu Button */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
      >
        {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      {/* Mobile Navigation Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-sm"
            onClick={closeMobileMenu}
          />

          {/* Menu */}
          <nav className="fixed top-0 right-0 bottom-0 w-64 bg-background border-l shadow-lg p-4 overflow-y-auto">
            <div className="flex justify-end mb-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={closeMobileMenu}
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex flex-col gap-1">
              {navItems.map((item) => (
                <NavItem
                  key={item.to}
                  to={item.to}
                  icon={item.icon}
                  onClick={closeMobileMenu}
                  badge={getBadge(item.to)}
                >
                  {item.label}
                </NavItem>
              ))}
              <NavItem
                to="/settings"
                icon={Settings}
                onClick={closeMobileMenu}
              >
                Settings
              </NavItem>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
