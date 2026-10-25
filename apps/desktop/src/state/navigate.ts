import { create } from 'zustand';

export type NavigateRequest =
  | { kind: 'heading'; index: number; nonce: number }
  | { kind: 'moveSection'; from: number; to: number; nonce: number };

export interface NavigateState {
  request: NavigateRequest | null;
  revealHeading: (index: number) => void;
  moveSection: (from: number, to: number) => void;
}

/**
 * In-document navigation asked for from outside the editor — the outline panel, mostly.
 *
 * Same one-way shape as the find bar: the panel states what it wants, and whichever
 * editor is mounted carries it out in its own terms.
 */
export const useNavigate = create<NavigateState>((set, get) => ({
  request: null,

  revealHeading: (index) =>
    set({ request: { kind: 'heading', index, nonce: nextNonce(get().request) } }),

  moveSection: (from, to) =>
    set({ request: { kind: 'moveSection', from, to, nonce: nextNonce(get().request) } }),
}));

function nextNonce(request: NavigateRequest | null): number {
  return (request?.nonce ?? 0) + 1;
}
