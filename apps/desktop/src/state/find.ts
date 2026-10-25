import { create } from 'zustand';

export type FindAction = 'next' | 'previous' | 'replace' | 'replaceAll';

export interface FindRequest {
  action: FindAction;
  /** Increments on every request, which is what the editor watches. */
  nonce: number;
}

export interface FindState {
  open: boolean;
  showReplace: boolean;
  query: string;
  replacement: string;
  regex: boolean;
  caseSensitive: boolean;

  /** Reported back by whichever editor is mounted. */
  total: number;
  current: number;
  error: string | null;

  request: FindRequest | null;

  openFind: (withReplace: boolean) => void;
  close: () => void;
  setQuery: (query: string) => void;
  setReplacement: (replacement: string) => void;
  setRegex: (regex: boolean) => void;
  setCaseSensitive: (caseSensitive: boolean) => void;
  report: (result: { total: number; current: number; error: string | null }) => void;
  ask: (action: FindAction) => void;
}

/**
 * The find bar states what it wants; the mounted editor carries it out and reports back.
 *
 * Keeping it one-way means the formatted view and the source view can implement find
 * however suits them without the bar knowing which one is on screen.
 */
export const useFind = create<FindState>((set, get) => ({
  open: false,
  showReplace: false,
  query: '',
  replacement: '',
  regex: false,
  caseSensitive: false,
  total: 0,
  current: -1,
  error: null,
  request: null,

  openFind: (withReplace) => set({ open: true, showReplace: withReplace }),

  close: () => set({ open: false, query: '', total: 0, current: -1, error: null, request: null }),

  setQuery: (query) => set({ query }),
  setReplacement: (replacement) => set({ replacement }),
  setRegex: (regex) => set({ regex }),
  setCaseSensitive: (caseSensitive) => set({ caseSensitive }),

  report: (result) => {
    const { total, current, error } = get();
    if (total === result.total && current === result.current && error === result.error) return;
    set(result);
  },

  ask: (action) => set({ request: { action, nonce: (get().request?.nonce ?? 0) + 1 } }),
}));
