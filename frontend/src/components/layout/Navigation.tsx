import { NavLink, useLocation } from "react-router-dom";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutDashboard,
  Briefcase,
  List,
  Search,
  TrendingUp,
  RefreshCw,
  Landmark,
  ArrowUpDown,
  Settings,
  Menu,
  X,
  MoreHorizontal,
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
  { to: "/spreads", label: "Spreads", icon: ArrowUpDown },
];

const moreItems = [
  { to: "/taxes", label: "Taxes", icon: Landmark },
];

function MoreDropdown() {
  const location = useLocation();
  const isMoreActive = moreItems.some((item) => location.pathname.startsWith(item.to));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
            isMoreActive
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          <MoreHorizontal className="h-4 w-4" />
          More
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {moreItems.map((item) => (
          <DropdownMenuItem key={item.to} asChild>
            <NavLink to={item.to} className="flex items-center gap-2 cursor-pointer">
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  return (
    <>
      {/* Desktop Navigation */}
      <nav className="hidden md:flex items-center gap-1">
        {navItems.map((item) => (
          <NavItem key={item.to} to={item.to} icon={item.icon}>
            {item.label}
          </NavItem>
        ))}
        <MoreDropdown />
        <NavItem to="/settings" icon={Settings}>
          Settings
        </NavItem>
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
              {[...navItems, ...moreItems].map((item) => (
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
