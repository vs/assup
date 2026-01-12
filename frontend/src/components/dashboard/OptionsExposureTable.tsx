import { Link } from "react-router-dom";
import { formatCurrency } from "@assup/shared";
import { ExposureTooltip } from "@/components/common";
import type { AllocationData } from "./AllocationTable";

interface OptionsExposureTableProps {
  data: AllocationData[];
  optionsWeightMode: "notional" | "delta";
}

export function OptionsExposureTable({ data, optionsWeightMode }: OptionsExposureTableProps) {
  const fmtCurrency = (value: number) => formatCurrency(value, { maximumFractionDigits: 0 });

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b">
            <th className="text-left py-3 px-2">Asset Class</th>
            <th className="text-right py-3 px-2">Stock Value</th>
            <th className="text-right py-3 px-2">
              <span className="inline-flex items-center gap-1">
                Options {optionsWeightMode === "delta" ? "Delta" : "Notional"}
                <ExposureTooltip showStocks={false} />
              </span>
            </th>
            <th className="text-right py-3 px-2">Total Exposure</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
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
              <td className="text-right py-3 px-2 font-mono">{fmtCurrency(row.stockValue)}</td>
              <td className="text-right py-3 px-2 font-mono">
                <span className={row.optionsExposure > 0 ? "text-green-600" : "text-red-600"}>
                  {row.optionsExposure > 0 ? "+" : ""}{fmtCurrency(row.optionsExposure)}
                </span>
              </td>
              <td className="text-right py-3 px-2 font-mono font-semibold">{fmtCurrency(row.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
