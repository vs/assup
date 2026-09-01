import { Badge } from "@/components/ui/badge";
import type { TaxSource } from "@assup/shared";

export function SourceBadge({ source }: { source: TaxSource }) {
  if (source === "dividend-report")
    return (
      <Badge variant="default" title="From IBKR Dividend Report">
        DR
      </Badge>
    );
  if (source === "flex+reversal")
    return (
      <Badge variant="outline" title="FLEX dividend; WHT reversed cross-date">
        FLEX+rev
      </Badge>
    );
  return (
    <Badge
      variant="secondary"
      title="Raw FLEX classification. Upload the Dividend Report to confirm."
    >
      FLEX
    </Badge>
  );
}
