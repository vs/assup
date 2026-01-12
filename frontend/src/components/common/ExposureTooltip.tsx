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

interface ExposureTooltipProps {
  /** Whether to show the stock value explanation */
  showStocks?: boolean;
  /** Custom trigger element (defaults to Info icon) */
  children?: React.ReactNode;
}

/**
 * Tooltip explaining how exposure is calculated for stocks and options
 */
export function ExposureTooltip({ showStocks = true, children }: ExposureTooltipProps) {
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
            <p className="font-medium">Total exposure = Stock Value + Options Notional</p>
            {showStocks && (
              <p className="font-medium mt-1">Stocks: Market Value</p>
            )}
            <p className="font-medium">Options: Strike × Qty × 100</p>
            <p className="mt-1">• Short PUT: +notional (obligation to buy)</p>
            <p>• Long PUT: −notional (right to sell/hedge)</p>
            <p>• Short CALL: −notional (obligation to sell)</p>
            <p>• Long CALL: +notional (right to buy)</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
