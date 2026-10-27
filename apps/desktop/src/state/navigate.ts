import { create } from 'zustand';

export type NavigateRequest =
  | { kind: 'heading'; index: number; nonce: number }
  | { kind: 'moveSection'; from: number; to: number; nonce: number }
  | { kind: 'frontmatter'; yaml: string; nonce: number }
  | { kind: 'insertMarkdown'; markdown: string; nonce: number };

export interface NavigateState {
  request: NavigateRequest | null;
  revealHeading: (index: number) => void;
  moveSection: (from: number, to: number) => void;
  setFrontmatter: (yaml: string) => void;
  insertMarkdown: (markdown: string) => void;
}

/**
 * Edits and navigation asked for from outside the editor — the outline, the frontmatter
 * form, the template commands.
 *
 * One-way, like the find bar: the caller states what it wants, and whichever editor is
 * mounted carries it out in its own terms, as a transaction it can undo.
 */
export const useNavigate = create<NavigateState>((set, get) => ({
  request: null,

  revealHeading: (index) =>
    set({ request: { kind: 'heading', index, nonce: nextNonce(get().request) } }),

  moveSection: (from, to) =>
    set({ request: { kind: 'moveSection', from, to, nonce: nextNonce(get().request) } }),

  setFrontmatter: (yaml) =>
    set({ request: { kind: 'frontmatter', yaml, nonce: nextNonce(get().request) } }),

  insertMarkdown: (markdown) =>
    set({ request: { kind: 'insertMarkdown', markdown, nonce: nextNonce(get().request) } }),
}));

function nextNonce(request: NavigateRequest | null): number {
  return (request?.nonce ?? 0) + 1;
}
