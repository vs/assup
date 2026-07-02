import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { MacroProvider } from "@/components/common/MacroProvider";
import { TickerProfileProvider } from "@/components/common/TickerProfileProvider";
import { ResearchJobsProvider } from "@/hooks/useResearchJobs";

const DashboardPage = lazy(() => import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const PositionsPage = lazy(() => import("@/pages/PositionsPage").then((m) => ({ default: m.PositionsPage })));
const WatchlistsPage = lazy(() => import("@/pages/WatchlistsPage").then((m) => ({ default: m.WatchlistsPage })));
const ScannerPage = lazy(() => import("@/pages/ScannerPage").then((m) => ({ default: m.ScannerPage })));
const ProfitPage = lazy(() => import("@/pages/ProfitPage").then((m) => ({ default: m.ProfitPage })));
const WheelPage = lazy(() => import("@/pages/WheelPage").then((m) => ({ default: m.WheelPage })));
const IronCondorPage = lazy(() => import("@/pages/IronCondorPage").then((m) => ({ default: m.IronCondorPage })));
const TaxesPage = lazy(() => import("@/pages/TaxesPage").then((m) => ({ default: m.TaxesPage })));
const ResearchReportPage = lazy(() => import("@/pages/ResearchReportPage").then((m) => ({ default: m.ResearchReportPage })));
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const ImportsSection = lazy(() => import("@/pages/settings/ImportsSection").then((m) => ({ default: m.ImportsSection })));
const AssetClassesSection = lazy(() => import("@/pages/settings/AssetClassesSection").then((m) => ({ default: m.AssetClassesSection })));
const ExchangeRatesSection = lazy(() => import("@/pages/settings/ExchangeRatesSection").then((m) => ({ default: m.ExchangeRatesSection })));
const ResearchSection = lazy(() => import("@/pages/settings/ResearchSection").then((m) => ({ default: m.ResearchSection })));
const SpreadsSection = lazy(() => import("@/pages/settings/SpreadsSection").then((m) => ({ default: m.SpreadsSection })));
const FlexAutoImportSection = lazy(() => import("@/pages/settings/FlexAutoImportSection").then((m) => ({ default: m.FlexAutoImportSection })));
const CalendarPage = lazy(() => import("@/pages/CalendarPage").then((m) => ({ default: m.CalendarPage })));

function SymbolRedirect() {
  const { symbol } = useParams();
  return <Navigate to={`/tickers/${symbol}`} replace />;
}

function App() {
  return (
    <ErrorBoundary>
      <MacroProvider>
      <TickerProfileProvider>
      <ResearchJobsProvider>
      <BrowserRouter>
        <Suspense fallback={null}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/positions" element={<PositionsPage />} />
            <Route path="/analysis" element={<WatchlistsPage />} />
            <Route path="/tickers/:symbol" element={<ResearchReportPage />} />
            <Route path="/analysis/:symbol" element={<SymbolRedirect />} />
            <Route path="/scanner" element={<ScannerPage />} />
            <Route path="/profit" element={<ProfitPage />} />
            <Route path="/wheel" element={<WheelPage />} />
            <Route path="/spreads" element={<IronCondorPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/taxes" element={<Navigate to="/settings/taxes" replace />} />
            <Route path="/watchlists" element={<Navigate to="/analysis" replace />} />
            <Route path="/watchlists/:symbol" element={<SymbolRedirect />} />
            <Route path="/research" element={<Navigate to="/analysis" replace />} />
            <Route path="/research/:symbol" element={<SymbolRedirect />} />
            <Route path="/settings" element={<SettingsPage />}>
              <Route index element={<Navigate to="/settings/imports" replace />} />
              <Route path="imports" element={<ImportsSection />} />
              <Route path="asset-classes" element={<AssetClassesSection />} />
              <Route path="exchange-rates" element={<ExchangeRatesSection />} />
              <Route path="research" element={<ResearchSection />} />
              <Route path="spreads" element={<SpreadsSection />} />
              <Route path="flex-import" element={<FlexAutoImportSection />} />
              <Route path="taxes" element={<TaxesPage />} />
            </Route>
          </Route>
        </Routes>
        </Suspense>
      </BrowserRouter>
      </ResearchJobsProvider>
      </TickerProfileProvider>
      </MacroProvider>
    </ErrorBoundary>
  );
}

export default App;
