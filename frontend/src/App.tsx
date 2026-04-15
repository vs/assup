import { BrowserRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { DashboardPage } from "@/pages/DashboardPage";
import { PositionsPage } from "@/pages/PositionsPage";
import { WatchlistsPage } from "@/pages/WatchlistsPage";
import { ScannerPage } from "@/pages/ScannerPage";
import { ProfitPage } from "@/pages/ProfitPage";
import { WheelPage } from "@/pages/WheelPage";
import { TaxesPage } from "@/pages/TaxesPage";
import { ResearchReportPage } from "@/pages/ResearchReportPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { ImportsSection } from "@/pages/settings/ImportsSection";
import { AssetClassesSection } from "@/pages/settings/AssetClassesSection";
import { ExchangeRatesSection } from "@/pages/settings/ExchangeRatesSection";
import { ResearchSection } from "@/pages/settings/ResearchSection";

function ResearchSymbolRedirect() {
  const { symbol } = useParams();
  return <Navigate to={`/watchlists/${symbol}`} replace />;
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/positions" element={<PositionsPage />} />
            <Route path="/watchlists" element={<WatchlistsPage />} />
            <Route path="/watchlists/:symbol" element={<ResearchReportPage />} />
            <Route path="/scanner" element={<ScannerPage />} />
            <Route path="/profit" element={<ProfitPage />} />
            <Route path="/wheel" element={<WheelPage />} />
            <Route path="/taxes" element={<TaxesPage />} />
            <Route path="/research" element={<Navigate to="/watchlists" replace />} />
            <Route path="/research/:symbol" element={<ResearchSymbolRedirect />} />
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
    </ErrorBoundary>
  );
}

export default App;
