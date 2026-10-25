import { devHttpProvider } from './dev-http';
import type { FileSystemProvider } from './types';

declare global {
  interface Window {
    /** Present only when the UI is running inside a Tauri webview. */
    __TAURI_INTERNALS__?: unknown;
  }
}

function selectProvider(): FileSystemProvider {
  if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined) {
    throw new Error('Running under Tauri, but the Tauri filesystem provider arrives in P9');
  }
  return devHttpProvider;
}

export const fsProvider: FileSystemProvider = selectProvider();

export * from './types';
