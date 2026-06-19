import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardPeriod } from "@assup/shared";
import { dashboardApi } from "@/api/dashboard";
import { profitApi } from "@/api/profit";
import { PageHeader } from "@/components/common/PageHeader";
import { CurrentMonthPace } from "@/components/dashboard/CurrentMonthPace";
import { PeriodSelector } from "@/components/dashboard/PeriodSelector";
import { PnlHero } from "@/components/dashboard/PnlHero";
import { PnlChart } from "@/components/dashboard/PnlChart";
import { StrategyBreakdown } from "@/components/dashboard/StrategyBreakdown";

export function DashboardPage() {
  const [period, setPeriod] = useState<DashboardPeriod>("ytd");
  const [year, setYear] = useState(new Date().getFullYear());

  const { data: yearsData } = useQuery({
    queryKey: ["profit", "years"],
    queryFn: () => profitApi.years(),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard", "summary", period, year],
    queryFn: () => dashboardApi.summary({ period, year: period === "year" ? year : undefined }),
  });

  const availableYears = yearsData?.years ?? [new Date().getFullYear()];

  return (
    <div className="space-y-4">
      <PageHeader title="Dashboard" description="Portfolio performance overview" />

      {data && <CurrentMonthPace data={data.currentMonthPace} />}

      <div className="flex items-center justify-between">
        {data ? (
          <PnlHero
            periodTotal={data.periodTotal}
            periodIncludesCurrentMonth={data.periodIncludesCurrentMonth}
          />
        ) : (
          <div />
        )}
        <PeriodSelector
          period={period}
          year={year}
          availableYears={availableYears}
          onPeriodChange={setPeriod}
          onYearChange={setYear}
        />
      </div>

      {isLoading && <div className="text-muted-foreground text-sm">Loading dashboard...</div>}
      {error && <div className="text-red-500 text-sm">Failed to load dashboard data</div>}

      {data && (
        <>
          <PnlChart data={data.chart} />
          <StrategyBreakdown strategies={data.strategies} />
        </>
      )}
    </div>
  );
}
