interface CacheEntry {
  state: unknown;
  /** The markdown this state corresponds to. */
  text: string;
}

/** Enough for a realistic set of open tabs without holding documents forever. */
const LIMIT = 40;

const cache = new Map<string, CacheEntry>();

/**
 * Keeps an editor's state alive across a tab switch, so undo history survives leaving a
 * document and coming back.
 *
 * The text is stored alongside and checked on the way out. Switching to source mode,
 * editing, and switching back would otherwise restore a formatted-view state built from
 * markdown that no longer exists — silently discarding the edit.
 */
export function readCachedState<T>(key: string, text: string): T | null {
  const entry = cache.get(key);
  if (!entry || entry.text !== text) return null;

  // Refresh insertion order so the busiest tabs are evicted last.
  cache.delete(key);
  cache.set(key, entry);
  return entry.state as T;
}

export function writeCachedState(key: string, state: unknown, text: string): void {
  cache.delete(key);
  cache.set(key, { state, text });

  while (cache.size > LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done === true) break;
    cache.delete(oldest.value);
  }
}

/** Called when a document closes; its cached states can never be useful again. */
export function dropCachedStates(pathPrefix: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${pathPrefix}::`)) cache.delete(key);
  }
}
