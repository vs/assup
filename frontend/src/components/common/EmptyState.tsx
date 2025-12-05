import { Button } from "@/components/ui/button";
import {
  Inbox,
  Layers,
  Briefcase,
  List,
  Search,
  Plus,
  type LucideIcon,
} from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-sm">{description}</p>
      {actionLabel && onAction && (
        <Button onClick={onAction}>
          <Plus className="h-4 w-4 mr-2" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

// Pre-configured empty states for common scenarios
export function NoAssetClassesEmpty({ onAction }: { onAction?: () => void }) {
  return (
    <EmptyState
      icon={Layers}
      title="No asset classes"
      description="Create your first asset class to start organizing your portfolio."
      actionLabel="Create Asset Class"
      onAction={onAction}
    />
  );
}

export function NoPositionsEmpty() {
  return (
    <EmptyState
      icon={Briefcase}
      title="No positions"
      description="Connect to TWS and ensure you have open positions to see them here."
    />
  );
}

export function NoWatchlistsEmpty({ onAction }: { onAction?: () => void }) {
  return (
    <EmptyState
      icon={List}
      title="No watchlists"
      description="Create a watchlist to track securities you're interested in."
      actionLabel="Create Watchlist"
      onAction={onAction}
    />
  );
}

export function NoSearchResultsEmpty() {
  return (
    <EmptyState
      icon={Search}
      title="No results found"
      description="Try adjusting your search criteria or filters."
    />
  );
}

export function NoDataEmpty({ message }: { message?: string }) {
  return (
    <EmptyState
      icon={Inbox}
      title="No data"
      description={message || "There's nothing to display here yet."}
    />
  );
}
