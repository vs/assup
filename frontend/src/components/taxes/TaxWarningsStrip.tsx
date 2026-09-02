import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export interface TaxWarnings {
  unmatchedDividendReport: Array<{ symbol: string; payDate: string }>;
  unpairedReversals: Array<{
    transactionId: string;
    symbol: string | null;
    description: string;
    amountUsd: number;
    date: string;
  }>;
  hasUnverifiedFlexDividends: boolean;
  hasUnverifiedFlexInterest: boolean;
}

export function TaxWarningsStrip({ warnings }: { warnings: TaxWarnings }) {
  const items: Array<{ title: string; description: string }> = [];

  if (warnings.unmatchedDividendReport.length > 0) {
    items.push({
      title: "Dividend Report rows without FLEX match",
      description: `${warnings.unmatchedDividendReport.length} record(s) in the Dividend Report have no matching FLEX dividend. Re-import the FLEX year if you expect a match.`,
    });
  }
  if (warnings.unpairedReversals.length > 0) {
    items.push({
      title: "Unpaired WHT cancellations",
      description: `${warnings.unpairedReversals.length} cancellation entr${
        warnings.unpairedReversals.length === 1 ? "y has" : "ies have"
      } no matching original WHT. Likely indicates FLEX data missing from an earlier year.`,
    });
  }
  if (warnings.hasUnverifiedFlexDividends || warnings.hasUnverifiedFlexInterest) {
    items.push({
      title: "Unverified rows",
      description:
        "Some dividends or interest rows are classified by raw FLEX only. Upload the Dividend Report for this year to confirm.",
    });
  }

  if (items.length === 0) return null;

  return (
    <Alert variant="default" className="border-amber-500/40">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertTitle>Tax data warnings</AlertTitle>
      <AlertDescription className="space-y-1">
        {items.map((item) => (
          <div key={item.title}>
            <span className="font-medium">{item.title}:</span> {item.description}
          </div>
        ))}
      </AlertDescription>
    </Alert>
  );
}
