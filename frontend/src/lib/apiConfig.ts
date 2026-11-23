/**
 * API base URL configuration
 *
 * In a browser the app is served by nginx (Docker) or Vite (dev), and both
 * proxy /api to the backend, so requests go to the page's own origin.
 * Override with VITE_API_URL. The Tauri desktop app has no proxy, so it uses
 * the URL injected by the Rust side or discovers the backend on known ports.
 */

import { isTauri } from './tauriIntegration';

declare global {
  interface Window {
    __ASSUP_API_URL__?: string;
  }
}

// Ports to try for backend discovery (live trading first, then paper)
const DISCOVERY_PORTS = [3001, 3737];

// The backend binds 127.0.0.1. Never use "localhost": it can resolve to ::1,
// where an unrelated dev server may be listening on the same port.
const DISCOVERY_HOST = '127.0.0.1';

// Empty base = same origin; paths like /api/... go through the proxy.
const SAME_ORIGIN = '';

let discoveredUrl: string | null = null;
let discoveryPromise: Promise<string> | null = null;

/**
 * Try to reach the backend health endpoint on a specific port
 */
async function checkBackendHealth(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`http://${DISCOVERY_HOST}:${port}/api/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!response.ok) return false;

    // Make sure it is the Assup backend, not some other server on that port
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null && 'database' in body && 'ibkr' in body;
  } catch {
    return false;
  }
}

/**
 * Discover the backend URL by trying known ports
 */
async function discoverBackend(): Promise<string> {
  // Check if already set via window global (Tauri injection)
  if (typeof window !== 'undefined' && window.__ASSUP_API_URL__) {
    return window.__ASSUP_API_URL__;
  }

  // Check Vite env var
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  // Browser: nginx / Vite proxy /api on the page's own origin
  if (!isTauri()) {
    return SAME_ORIGIN;
  }

  // Tauri: try each port
  for (const port of DISCOVERY_PORTS) {
    console.log(`[API] Trying backend on port ${port}...`);
    if (await checkBackendHealth(port)) {
      const url = `http://${DISCOVERY_HOST}:${port}`;
      console.log(`[API] Found backend at ${url}`);
      return url;
    }
  }

  const fallback = `http://${DISCOVERY_HOST}:3737`;
  console.error(`[API] No Assup backend found on ports ${DISCOVERY_PORTS.join(', ')}; using ${fallback}`);
  return fallback;
}

/**
 * Initialize backend discovery - call this before making API requests
 */
export async function initApiBase(): Promise<string> {
  if (discoveredUrl !== null) {
    return discoveredUrl;
  }

  if (!discoveryPromise) {
    discoveryPromise = discoverBackend().then(url => {
      discoveredUrl = url;
      return url;
    });
  }

  return discoveryPromise;
}

/**
 * Get the API base URL (must call initApiBase first for discovery)
 */
export function getApiBase(): string {
  // Return discovered URL if available
  if (discoveredUrl !== null) {
    return discoveredUrl;
  }

  // Check window global (Tauri injection)
  if (typeof window !== 'undefined' && window.__ASSUP_API_URL__) {
    return window.__ASSUP_API_URL__;
  }

  // Fallback (shouldn't happen if initApiBase was called)
  return import.meta.env.VITE_API_URL || SAME_ORIGIN;
}

