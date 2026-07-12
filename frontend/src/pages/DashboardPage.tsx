import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DashboardPeriod } from "@assup/shared";
import { dashboardApi } from "@/api/dashboard";
import { profitApi } from "@/api/profit";
import { positionsApi } from "@/api/positions";
import { ironCondorApi } from "@/api/ironCondor";
import { wheelApi } from "@/api/wheel";
import { PageHeader } from "@/components/common";
import { CurrentMonthPace } from "@/components/dashboard/CurrentMonthPace";
import { PeriodSelector } from "@/components/dashboard/PeriodSelector";
import { PnlChart } from "@/components/dashboard/PnlChart";
import { UpcomingEvents } from "@/components/dashboard/UpcomingEvents";
import { MetricsRow } from "@/components/dashboard/MetricsRow";
import { GainersLosers } from "@/components/dashboard/GainersLosers";
import { ActiveWheelsList } from "@/components/dashboard/ActiveWheelsList";
import { ActiveSpreadsList } from "@/components/dashboard/ActiveSpreadsList";
import { NlvChart } from "@/components/dashboard/NlvChart";

export function DashboardPage() {
  const [period, setPeriod] = useState<DashboardPeriod>("year");
  const [year, setYear] = useState(new Date().getFullYear());

  const yearsData = useQuery({
    queryKey: ["profit", "years"],
    queryFn: () => profitApi.years(),
  });

  const dashboardData = useQuery({
    queryKey: ["dashboard", "summary", period, year],
    queryFn: () => dashboardApi.summary({ period, year: period === "year" ? year : undefined }),
  });

  const positionSummary = useQuery({
    queryKey: ["positions", "summary"],
    queryFn: () => positionsApi.summary({ includeOptions: true, optionsWeightMode: "notional" }),
  });

  const spreadsData = useQuery({
    queryKey: ["spreads", "positions"],
    queryFn: () => ironCondorApi.getActiveSpreads(),
  });

  const wheelData = useQuery({
    queryKey: ["wheel", "list"],
    queryFn: () => wheelApi.list({ includeSuggestions: false }),
  });

  const profitPositions = useQuery({
    queryKey: ["profit", "positions"],
    queryFn: () => profitApi.positions(),
  });

  const availableYears = yearsData.data?.years ?? [new Date().getFullYear()];
  const data = dashboardData.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <PageHeader title="Dashboard" subtitle="Portfolio performance overview" />
        <PeriodSelector
          period={period}
          year={year}
          availableYears={availableYears}
          onPeriodChange={setPeriod}
          onYearChange={setYear}
        />
      </div>

      <MetricsRow
        positionSummary={positionSummary.data}
        spreads={spreadsData.data?.spreads}
        wheelData={wheelData.data}
        profitPositions={profitPositions.data}
      />

      {/* Chart (4/6) + Right sidebar (2/6) — constrained height */}
      <div className="grid grid-cols-6 gap-3 items-stretch min-h-[320px] max-h-[480px]">
        <div className="col-span-4 min-h-0">
          {dashboardData.isLoading && (
            <div className="text-muted-foreground text-sm p-4">Loading...</div>
          )}
          {data && (
            <PnlChart
              data={data.chart}
              periodTotal={data.periodTotal}
              periodIncludesCurrentMonth={data.periodIncludesCurrentMonth}
            />
          )}
        </div>
        <div className="col-span-2 flex flex-col gap-3 min-h-0">
          {data && <CurrentMonthPace data={data.currentMonthPace} />}
          <UpcomingEvents />
        </div>
      </div>

      {/* Bottom 3-column grid */}
      <div className="grid grid-cols-3 gap-3">
        <GainersLosers positions={positionSummary.data?.positions} />
        <ActiveWheelsList tickers={wheelData.data?.tickers} />
        <ActiveSpreadsList spreads={spreadsData.data?.spreads} />
      </div>

      {/* Account value history */}
      <NlvChart />
    </div>
  );
}
