import { useState, useMemo, useCallback } from "react";
import { Table, TableBody } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ChevronsUpDown, ChevronsDownUp } from "lucide-react";
import { TickerGroup } from "./TickerGroup";
import type { OptionOpportunity } from "@assup/shared";
import type { ExtendedOptionOpportunity, TickerGroup as TickerGroupType, DTEGroup } from "./types";

interface GroupedResultsTableProps {
  opportunities: (OptionOpportunity & { underlyingPrice?: number })[];
}

function groupOpportunities(opportunities: ExtendedOptionOpportunity[]): TickerGroupType[] {
  // Group by symbol
  const bySymbol = new Map<string, ExtendedOptionOpportunity[]>();
  for (const opp of opportunities) {
    const existing = bySymbol.get(opp.symbol) || [];
    existing.push(opp);
    bySymbol.set(opp.symbol, existing);
  }

  // Transform to TickerGroup structure
  const tickerGroups: TickerGroupType[] = [];

  for (const [symbol, opps] of bySymbol) {
    // Group by DTE within symbol
    const byDTE = new Map<number, ExtendedOptionOpportunity[]>();
    for (const opp of opps) {
      const existing = byDTE.get(opp.daysToExpiry) || [];
      existing.push(opp);
      byDTE.set(opp.daysToExpiry, existing);
    }

    // Create DTE groups sorted by ascending DTE
    const dteGroups: DTEGroup[] = Array.from(byDTE.entries())
      .sort(([a], [b]) => a - b)
      .map(([dte, dteOpps]) => {
        // Sort opportunities within DTE by strike ascending
        const sortedOpps = [...dteOpps].sort((a, b) => a.strike - b.strike);
        return {
          dte,
          expiration: dteOpps[0].expiration,
          opportunities: sortedOpps,
          summary: {
            count: dteOpps.length,
            bestAnnualReturn: Math.max(...dteOpps.map((o) => o.annualizedReturn)),
            bestPremiumPercent: Math.max(...dteOpps.map((o) => o.premiumPercent)),
          },
        };
      });

    // Get first opportunity for metadata
    const firstOpp = opps[0];

    tickerGroups.push({
      symbol,
      underlyingPrice: firstOpp.underlyingPrice ?? null,
      assetClassName: firstOpp.assetClassName,
      assetClassColor: firstOpp.assetClassColor,
      dteGroups,
      summary: {
        totalCount: opps.length,
        bestAnnualReturn: Math.max(...opps.map((o) => o.annualizedReturn)),
        bestPremiumPercent: Math.max(...opps.map((o) => o.premiumPercent)),
        uniqueExpirations: dteGroups.length,
      },
    });
  }

  // Sort ticker groups alphabetically
  return tickerGroups.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function GroupedResultsTable({ opportunities }: GroupedResultsTableProps) {
  const tickerGroups = useMemo(
    () => groupOpportunities(opportunities as ExtendedOptionOpportunity[]),
    [opportunities]
  );

  // Initialize with first ticker and its DTEs expanded
  const [expandedTickers, setExpandedTickers] = useState<Set<string>>(() => {
    if (tickerGroups.length === 0) return new Set();
    return new Set([tickerGroups[0].symbol]);
  });

  const [expandedDTEs, setExpandedDTEs] = useState<Set<string>>(() => {
    if (tickerGroups.length === 0) return new Set();
    const firstTicker = tickerGroups[0];
    return new Set(firstTicker.dteGroups.map((d) => `${firstTicker.symbol}-${d.dte}`));
  });

  const handleToggleTicker = useCallback((symbol: string) => {
    setExpandedTickers((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) {
        next.delete(symbol);
      } else {
        next.add(symbol);
      }
      return next;
    });
  }, []);

  const handleToggleDTE = useCallback((dteKey: string) => {
    setExpandedDTEs((prev) => {
      const next = new Set(prev);
      if (next.has(dteKey)) {
        next.delete(dteKey);
      } else {
        next.add(dteKey);
      }
      return next;
    });
  }, []);

  const handleExpandAll = useCallback(() => {
    setExpandedTickers(new Set(tickerGroups.map((g) => g.symbol)));
    setExpandedDTEs(
      new Set(
        tickerGroups.flatMap((g) =>
          g.dteGroups.map((d) => `${g.symbol}-${d.dte}`)
        )
      )
    );
  }, [tickerGroups]);

  const handleCollapseAll = useCallback(() => {
    setExpandedTickers(new Set());
    setExpandedDTEs(new Set());
  }, []);

  const allExpanded =
    expandedTickers.size === tickerGroups.length &&
    expandedDTEs.size ===
      tickerGroups.reduce((sum, g) => sum + g.dteGroups.length, 0);

  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={allExpanded ? handleCollapseAll : handleExpandAll}
        >
          {allExpanded ? (
            <>
              <ChevronsDownUp className="h-4 w-4 mr-1" />
              Collapse All
            </>
          ) : (
            <>
              <ChevronsUpDown className="h-4 w-4 mr-1" />
              Expand All
            </>
          )}
        </Button>
      </div>
      <Table className="table-fixed w-full">
        <colgroup>
          <col className="w-[32%]" />  {/* Contract */}
          <col className="w-[9%]" />   {/* Price */}
          <col className="w-[9%]" />   {/* Bid */}
          <col className="w-[9%]" />   {/* Ask */}
          <col className="w-[9%]" />   {/* Premium */}
          <col className="w-[8%]" />   {/* Delta */}
          <col className="w-[11%]" />  {/* Premium % */}
          <col className="w-[13%]" />  {/* Annual Return */}
        </colgroup>
        <TableBody>
          {tickerGroups.map((tickerGroup) => (
            <TickerGroup
              key={tickerGroup.symbol}
              tickerGroup={tickerGroup}
              isExpanded={expandedTickers.has(tickerGroup.symbol)}
              onToggle={() => handleToggleTicker(tickerGroup.symbol)}
              expandedDTEs={expandedDTEs}
              onToggleDTE={handleToggleDTE}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
