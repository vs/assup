import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export interface UnverifiedFlexDividend {
  symbol: string;
  date: string;
  grossUsd: number;
  withholdingTaxUsd: number;
}

export interface UnverifiedFlexInterest {
  date: string;
  description: string;
  amountUsd: number;
}

export interface TaxWarnings {
  unmatchedDividendReport: Array<{ symbol: string; payDate: string }>;
  unpairedReversals: Array<{
    transactionId: string;
    symbol: string | null;
    description: string;
    amountUsd: number;
    date: string;
  }>;
  unverifiedFlexDividends: UnverifiedFlexDividend[];
  unverifiedFlexInterest: UnverifiedFlexInterest[];
}

interface WarningItem {
  title: string;
  description: string;
  rows?: React.ReactNode;
}

function fmtUsd(n: number): string {
  const sign = n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export function TaxWarningsStrip({ warnings }: { warnings: TaxWarnings }) {
  const items: WarningItem[] = [];

  if (warnings.unmatchedDividendReport.length > 0) {
    items.push({
      title: "Dividend Report rows without FLEX match",
      description: `${warnings.unmatchedDividendReport.length} record(s) in the Dividend Report have no matching FLEX dividend. Re-import the FLEX year if you expect a match.`,
      rows: (
        <ul className="mt-1 ml-4 list-disc text-xs text-muted-foreground">
          {warnings.unmatchedDividendReport.map((r) => (
            <li key={`${r.symbol}-${r.payDate}`}>
              <span className="font-medium">{r.symbol}</span> · pay date {r.payDate}
            </li>
          ))}
        </ul>
      ),
    });
  }

  if (warnings.unpairedReversals.length > 0) {
    items.push({
      title: "Unpaired WHT cancellations",
      description: `${warnings.unpairedReversals.length} cancellation entr${
        warnings.unpairedReversals.length === 1 ? "y has" : "ies have"
      } no matching original WHT. Likely indicates FLEX data missing from an earlier year.`,
      rows: (
        <ul className="mt-1 ml-4 list-disc text-xs text-muted-foreground">
          {warnings.unpairedReversals.map((r) => (
            <li key={r.transactionId}>
              {r.date} · <span className="font-medium">{r.symbol ?? "(broker)"}</span> ·{" "}
              {fmtUsd(r.amountUsd)} · <span className="text-muted-foreground/70">{r.description}</span>
            </li>
          ))}
        </ul>
      ),
    });
  }

  const unverifiedCount =
    warnings.unverifiedFlexDividends.length + warnings.unverifiedFlexInterest.length;
  if (unverifiedCount > 0) {
    items.push({
      title: "Unverified rows",
      description:
        "Some dividends or interest rows are classified by raw FLEX only. Upload the Dividend Report for this year to confirm.",
      rows: (
        <ul className="mt-1 ml-4 list-disc text-xs text-muted-foreground">
          {warnings.unverifiedFlexDividends.map((d) => (
            <li key={`div-${d.symbol}-${d.date}`}>
              dividend · {d.date} · <span className="font-medium">{d.symbol}</span> · gross{" "}
              {fmtUsd(d.grossUsd)} · WHT {fmtUsd(d.withholdingTaxUsd)}
            </li>
          ))}
          {warnings.unverifiedFlexInterest.map((i, idx) => (
            <li key={`int-${i.date}-${idx}`}>
              interest · {i.date} · {fmtUsd(i.amountUsd)} ·{" "}
              <span className="text-muted-foreground/70">{i.description}</span>
            </li>
          ))}
        </ul>
      ),
    });
  }

  if (items.length === 0) return null;

  return (
    <Alert variant="default" className="border-amber-500/40">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertTitle>Tax data warnings</AlertTitle>
      <AlertDescription className="space-y-2">
        {items.map((item) => (
          <div key={item.title}>
            <span className="font-medium">{item.title}:</span> {item.description}
            {item.rows}
          </div>
        ))}
      </AlertDescription>
    </Alert>
  );
}
