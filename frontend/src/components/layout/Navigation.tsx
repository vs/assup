import { NavLink } from "react-router-dom";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { ConnectionStatusPopup } from "@/components/ConnectionStatus";
import {
  LayoutDashboard,
  Briefcase,
  List,
  Search,
  TrendingUp,
  RefreshCw,
  Landmark,
  Settings,
  Menu,
  X,
} from "lucide-react";

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
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/positions", label: "Positions", icon: Briefcase },
  { to: "/analysis", label: "Watchlists", icon: List },
  { to: "/scanner", label: "Scanner", icon: Search },
  { to: "/profit", label: "Profit", icon: TrendingUp },
  { to: "/wheel", label: "Wheel", icon: RefreshCw },
  { to: "/taxes", label: "Taxes", icon: Landmark },
];

export function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const { status, sseError } = useConnectionStatus();
  const isConnected = status.connected;
  const [isHovering, setIsHovering] = useState(false);

  const connectionDot = (
    <span
      className={`absolute top-0 right-0 h-2 w-2 rounded-full ${
        isConnected
          ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)] animate-breathing"
          : "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]"
      }`}
    />
  );

  return (
    <>
      {/* Desktop Navigation */}
      <nav className="hidden md:flex items-center gap-1">
        {navItems.map((item) => (
          <NavItem key={item.to} to={item.to} icon={item.icon}>
            {item.label}
          </NavItem>
        ))}
        <div
          className="relative"
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
        >
          <NavItem to="/settings" icon={Settings} badge={connectionDot}>
            Settings
          </NavItem>
          {isHovering && (
            <ConnectionStatusPopup status={status} sseError={sseError} />
          )}
        </div>
      </nav>

      {/* Mobile Menu Button */}
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
      >
        {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      {/* Mobile Navigation Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
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
                >
                  {item.label}
                </NavItem>
              ))}
              <NavItem
                to="/settings"
                icon={Settings}
                onClick={closeMobileMenu}
                badge={connectionDot}
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
