/**
 * Reusable page header component with title, subtitle, and optional refresh button
 * Used consistently across all pages for a unified look
 */

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PageHeaderProps {
  /** Page title */
  title: string;
  /** Optional subtitle/description */
  subtitle?: string;
  /** Whether data is currently loading (shows spinner on refresh button) */
  loading?: boolean;
  /** Callback when refresh is clicked */
  onRefresh?: () => void;
  /** Optional additional actions (buttons, etc.) to show on the right */
  actions?: React.ReactNode;
  /** Optional content to show below the title (e.g., filters) */
  children?: React.ReactNode;
}

/**
 * Standard page header with title, optional refresh button, and actions
 */
export function PageHeader({
  title,
  subtitle,
  loading,
  onRefresh,
  actions,
  children,
}: PageHeaderProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {onRefresh && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
