import { NavLink, Outlet } from "react-router-dom";
import { PageHeader } from "@/components/common";

const settingsTabs = [
  { to: "/settings/imports", label: "FLEX Imports" },
  { to: "/settings/asset-classes", label: "Asset Classes" },
  { to: "/settings/research", label: "Research" },
  { to: "/settings/spreads", label: "Spreads" },
  { to: "/settings/taxes", label: "Taxes" },
  { to: "/settings/exchange-rates", label: "Exchange Rates" },
  { to: "/settings/calendar", label: "Calendar" },
];

export function SettingsPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Settings" />
      <div className="bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]">
        {settingsTabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `inline-flex h-[calc(100%-1px)] items-center justify-center rounded-md border px-2 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] ${
                isActive
                  ? "bg-background text-foreground border-input shadow-sm"
                  : "border-transparent text-foreground dark:text-muted-foreground"
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
