import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { DashboardPage } from "@/pages/DashboardPage";
import { AssetClassesPage } from "@/pages/AssetClassesPage";
import { PositionsPage } from "@/pages/PositionsPage";
import { WatchlistsPage } from "@/pages/WatchlistsPage";
import { OrdersPage } from "@/pages/OrdersPage";
import { ScannerPage } from "@/pages/ScannerPage";
import { ProfitPage } from "@/pages/ProfitPage";
import { WheelPage } from "@/pages/WheelPage";
import { TaxesPage } from "@/pages/TaxesPage";
import { ExchangeRatesPage } from "@/pages/ExchangeRatesPage";

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/positions" element={<PositionsPage />} />
            <Route path="/watchlists" element={<WatchlistsPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/scanner" element={<ScannerPage />} />
            <Route path="/profit" element={<ProfitPage />} />
            <Route path="/wheel" element={<WheelPage />} />
            <Route path="/taxes" element={<TaxesPage />} />
            <Route path="/settings/exchange-rates" element={<ExchangeRatesPage />} />
            <Route path="/asset-classes" element={<AssetClassesPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
