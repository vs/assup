/**
 * API base URL configuration
 * Supports override via window global (for Tauri) or Vite env var
 * Falls back to auto-discovery by trying common ports
 */

declare global {
  interface Window {
    __ASSUP_API_URL__?: string;
  }
}

// Ports to try for backend discovery (live trading first, then paper)
const DISCOVERY_PORTS = [3001, 3000];

let discoveredUrl: string | null = null;
let discoveryPromise: Promise<string> | null = null;

/**
 * Try to reach the backend health endpoint on a specific port
 */
async function checkBackendHealth(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`http://localhost:${port}/api/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.ok;
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

  // Try each port
  for (const port of DISCOVERY_PORTS) {
    console.log(`[API] Trying backend on port ${port}...`);
    if (await checkBackendHealth(port)) {
      const url = `http://localhost:${port}`;
      console.log(`[API] Found backend at ${url}`);
      return url;
    }
  }

  // Fallback to default
  console.warn('[API] No backend found, using default port 3000');
  return 'http://localhost:3000';
}

/**
 * Initialize backend discovery - call this before making API requests
 */
export async function initApiBase(): Promise<string> {
  if (discoveredUrl) {
    return discoveredUrl;
  }

  if (!discoveryPromise) {
    discoveryPromise = discoverBackend().then(url => {
      discoveredUrl = url;
      window.__ASSUP_API_URL__ = url;
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
  if (discoveredUrl) {
    return discoveredUrl;
  }

  // Check window global (Tauri injection)
  if (typeof window !== 'undefined' && window.__ASSUP_API_URL__) {
    return window.__ASSUP_API_URL__;
  }

  // Fallback (shouldn't happen if initApiBase was called)
  return import.meta.env.VITE_API_URL || 'http://localhost:3000';
}

