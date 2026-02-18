import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isTauri, invokeBackendDiscovery } from './lib/tauriIntegration'
import { setApiBase } from './lib/apiConfig'

async function init() {
  // When running in Tauri, discover the backend URL before rendering
  if (isTauri()) {
    const backendUrl = await invokeBackendDiscovery();
    if (backendUrl) {
      setApiBase(backendUrl);
    }
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

init();
