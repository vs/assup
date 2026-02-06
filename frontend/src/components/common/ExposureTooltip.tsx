/**
 * Reusable tooltip explaining options exposure calculations
 * Used in PositionsPage and DashboardPage to explain notional/delta values
 */

import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type OptionType = "put" | "call" | "all";

interface ExposureTooltipProps {
  /** Whether to show the stock value explanation */
  showStocks?: boolean;
  /** Which option type to explain (put, call, or all) */
  optionType?: OptionType;
  /** Custom trigger element (defaults to Info icon) */
  children?: React.ReactNode;
}

/**
 * Tooltip explaining how exposure is calculated for stocks and options
 */
export function ExposureTooltip({ showStocks = true, optionType = "all", children }: ExposureTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {children || (
            <Info className="h-3.5 w-3.5 text-muted-foreground/70 cursor-help" />
          )}
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">
          <div className="space-y-1">
            {optionType === "all" && (
              <p className="font-medium">Total exposure = Stock Value + Options Notional</p>
            )}
            {showStocks && (
              <p className="font-medium mt-1">Stocks: Market Value</p>
            )}
            <p className="font-medium">Notional: Strike × Qty × 100</p>
            {optionType === "put" && (
              <>
                <p className="mt-1">• Short PUT: obligation to buy underlying at strike</p>
                <p>• Long PUT: right to sell underlying at strike</p>
              </>
            )}
            {optionType === "call" && (
              <>
                <p className="mt-1">• Short CALL: obligation to sell underlying at strike</p>
                <p>• Long CALL: right to buy underlying at strike</p>
              </>
            )}
            {optionType === "all" && (
              <>
                <p className="mt-1">• Short PUT: +notional (obligation to buy)</p>
                <p>• Long PUT: −notional (right to sell/hedge)</p>
                <p>• Short CALL: −notional (obligation to sell)</p>
                <p>• Long CALL: +notional (right to buy)</p>
              </>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
