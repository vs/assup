import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initApiBase } from './lib/apiConfig'

async function init() {
  // Discover backend before rendering (tries ports 3001, 3000)
  const backendUrl = await initApiBase();
  console.log('[Init] Using backend:', backendUrl);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

init();
