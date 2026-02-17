/**
 * API base URL configuration
 * Supports override via window global (for Tauri) or Vite env var
 */

declare global {
  interface Window {
    __ASSUP_API_URL__?: string;
  }
}

export function getApiBaseUrl(): string {
  // Tauri injects this global after auto-discovery
  if (typeof window !== 'undefined' && window.__ASSUP_API_URL__) {
    return window.__ASSUP_API_URL__;
  }
  // Fall back to Vite env var or default
  return import.meta.env.VITE_API_URL || 'http://localhost:3000';
}

let cachedBaseUrl: string | null = null;

export function getApiBase(): string {
  if (cachedBaseUrl === null) {
    cachedBaseUrl = getApiBaseUrl();
  }
  return cachedBaseUrl;
}

export function setApiBase(url: string): void {
  cachedBaseUrl = url;
  window.__ASSUP_API_URL__ = url;
}
