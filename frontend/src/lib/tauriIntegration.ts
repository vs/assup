/**
 * Tauri desktop integration utilities
 * These functions are no-ops when running in a regular browser
 */

declare global {
  interface Window {
    __TAURI__?: {
      core: {
        invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
      };
    };
  }
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && !!window.__TAURI__;
}

export async function setDockBadge(connected: boolean): Promise<void> {
  if (!isTauri()) return;

  try {
    // Tauri doesn't have direct dock badge API, but we can use app icon overlay
    // For now, we'll just log the connection status
    // A more sophisticated implementation would use tauri-plugin-notification
    // or custom dock tile rendering
    console.log(`[Tauri] Connection status: ${connected ? 'connected' : 'disconnected'}`);
  } catch (e) {
    console.error('Failed to set dock badge:', e);
  }
}

