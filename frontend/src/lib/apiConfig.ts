/**
 * API base URL configuration
 * Supports override via window global (for Tauri) or Vite env var
 */

declare global {
  interface Window {
    __ASSUP_API_URL__?: string;
  }
}

export function getApiBase(): string {
  // Always check window global first (Tauri injects this asynchronously)
  // Don't cache to avoid race condition with Tauri's async discovery
  if (typeof window !== 'undefined' && window.__ASSUP_API_URL__) {
    return window.__ASSUP_API_URL__;
  }
  return import.meta.env.VITE_API_URL || 'http://localhost:3000';
}

export function setApiBase(url: string): void {
  window.__ASSUP_API_URL__ = url;
}
