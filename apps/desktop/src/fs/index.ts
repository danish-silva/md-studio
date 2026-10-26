import { devHttpProvider } from './dev-http';
import { tauriProvider } from './tauri';
import type { FileSystemProvider } from './types';

declare global {
  interface Window {
    /** Present only when the UI is running inside a Tauri webview. */
    __TAURI_INTERNALS__?: unknown;
  }
}

function selectProvider(): FileSystemProvider {
  // Inside the Tauri webview, go to Rust; in a browser, to the dev middleware.
  if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined) {
    return tauriProvider;
  }
  return devHttpProvider;
}

export const fsProvider: FileSystemProvider = selectProvider();

export * from './types';
