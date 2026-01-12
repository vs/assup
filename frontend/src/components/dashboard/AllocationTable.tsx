import { Link } from "react-router-dom";
import { formatCurrency } from "@assup/shared";
import { Badge } from "@/components/ui/badge";

export interface AllocationData {
  id: string | null;
  name: string;
  current: number;
  target: number;
  diff: number;
  color: string;
  value: number;
  stockValue: number;
  optionsExposure: number;
}

interface AllocationTableProps {
  data: AllocationData[];
  netLiquidation: number;
}

export function AllocationTable({ data, netLiquidation }: AllocationTableProps) {
  const fmtCurrency = (value: number) => formatCurrency(value, { maximumFractionDigits: 0 });

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b">
            <th className="text-left py-3 px-2">Asset Class</th>
            <th className="text-right py-3 px-2">Target %</th>
            <th className="text-right py-3 px-2">Current %</th>
            <th className="text-right py-3 px-2">Diff %</th>
            <th className="text-right py-3 px-2">Target Value</th>
            <th className="text-right py-3 px-2">Current Value</th>
            <th className="text-right py-3 px-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => {
            const targetValue = (row.target / 100) * netLiquidation;
            const diffValue = row.value - targetValue;
            return (
              <tr key={row.name} className="border-b">
                <td className="py-3 px-2">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full" style={{ backgroundColor: row.color }} />
                    {row.id && row.id !== "unassigned" ? (
                      <Link to={`/positions?assetClassId=${row.id}`} className="hover:text-primary hover:underline">
                        {row.name}
                      </Link>
                    ) : (
                      row.name
                    )}
                  </div>
                </td>
                <td className="text-right py-3 px-2">{row.target.toFixed(1)}%</td>
                <td className="text-right py-3 px-2">{row.current.toFixed(1)}%</td>
                <td className="py-3 px-2">
                  <DiffBar diff={row.diff} />
                </td>
                <td className="text-right py-3 px-2 font-mono">{fmtCurrency(targetValue)}</td>
                <td className="text-right py-3 px-2 font-mono">{fmtCurrency(row.value)}</td>
                <td className="text-right py-3 px-2">
                  <ActionBadge id={row.id} diffValue={diffValue} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DiffBar({ diff }: { diff: number }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="w-16 h-3 flex items-center">
        <div className="w-full h-1.5 bg-muted rounded-full relative">
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border" />
          {diff !== 0 && (
            <div
              className={`absolute top-0 h-full rounded-full ${diff > 0 ? "bg-green-500" : "bg-red-500"}`}
              style={{
                left: diff > 0 ? "50%" : `${50 - Math.min(Math.abs(diff) * 2, 50)}%`,
                width: `${Math.min(Math.abs(diff) * 2, 50)}%`,
              }}
            />
          )}
        </div>
      </div>
      <span className={`min-w-[4rem] text-right ${diff > 0.5 ? "text-green-600" : diff < -0.5 ? "text-red-600" : ""}`}>
        {diff > 0 ? "+" : ""}{diff.toFixed(1)}%
      </span>
    </div>
  );
}

function ActionBadge({ id, diffValue }: { id: string | null; diffValue: number }) {
  const fmtCurrency = (value: number) => formatCurrency(value, { maximumFractionDigits: 0 });

  if (!id || id === "unassigned") return <span className="text-muted-foreground">-</span>;

  if (diffValue < -1) {
    return (
      <Badge variant="success" asChild>
        <Link to={`/scanner?assetClassId=${id}`}>BUY {fmtCurrency(Math.abs(diffValue))}</Link>
      </Badge>
    );
  }

  if (diffValue > 1) {
    return (
      <Badge variant="danger" asChild>
        <Link to={`/scanner?assetClassId=${id}`}>SELL {fmtCurrency(diffValue)}</Link>
      </Badge>
    );
  }

  return <span className="text-muted-foreground">-</span>;
}
