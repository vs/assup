import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { MacroProvider } from "@/components/common/MacroProvider";
import { TickerProfileProvider } from "@/components/common/TickerProfileProvider";
import { ResearchJobsProvider } from "@/hooks/useResearchJobs";
import { DashboardPage } from "@/pages/DashboardPage";
import { PositionsPage } from "@/pages/PositionsPage";
import { WatchlistsPage } from "@/pages/WatchlistsPage";
import { ScannerPage } from "@/pages/ScannerPage";
import { ProfitPage } from "@/pages/ProfitPage";
import { WheelPage } from "@/pages/WheelPage";
import { IronCondorPage } from "@/pages/IronCondorPage";
import { TaxesPage } from "@/pages/TaxesPage";
import { ResearchReportPage } from "@/pages/ResearchReportPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { ImportsSection } from "@/pages/settings/ImportsSection";
import { AssetClassesSection } from "@/pages/settings/AssetClassesSection";
import { ExchangeRatesSection } from "@/pages/settings/ExchangeRatesSection";
import { ResearchSection } from "@/pages/settings/ResearchSection";

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
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/positions" element={<PositionsPage />} />
            <Route path="/analysis" element={<WatchlistsPage />} />
            <Route path="/tickers/:symbol" element={<ResearchReportPage />} />
            <Route path="/analysis/:symbol" element={<SymbolRedirect />} />
            <Route path="/scanner" element={<ScannerPage />} />
            <Route path="/profit" element={<ProfitPage />} />
            <Route path="/wheel" element={<WheelPage />} />
            <Route path="/iron-condor" element={<IronCondorPage />} />
            <Route path="/taxes" element={<TaxesPage />} />
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
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
      </ResearchJobsProvider>
      </TickerProfileProvider>
      </MacroProvider>
    </ErrorBoundary>
  );
}

export default App;
