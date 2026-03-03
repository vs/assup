import { NavLink, Outlet } from "react-router-dom";
import { FileUp, Layers, DollarSign } from "lucide-react";

const settingsNav = [
  { to: "/settings/imports", label: "FLEX Imports", icon: FileUp },
  { to: "/settings/asset-classes", label: "Asset Classes", icon: Layers },
  { to: "/settings/exchange-rates", label: "Exchange Rates", icon: DollarSign },
];

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>
      <div className="flex gap-8">
        <nav className="w-48 shrink-0">
          <div className="sticky top-28 space-y-1">
            {settingsNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
        <div className="flex-1 min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
