export interface FuzzyMatch<T> {
  item: T;
  score: number;
  /** Indices into the haystack that matched, for highlighting. */
  indices: number[];
}

/**
 * Subsequence matching, ranked.
 *
 * Deliberately small: quick-open wants "wmd" to find "welcome.md" and to put a filename
 * match above a folder match. Anything cleverer is not worth the weight.
 */
export function fuzzyScore(haystack: string, needle: string): FuzzyMatch<string> | null {
  if (needle.length === 0) return { item: haystack, score: 0, indices: [] };

  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();

  const indices: number[] = [];
  let score = 0;
  let at = 0;
  let previous = -2;

  for (const character of lowerNeedle) {
    const found = lowerHay.indexOf(character, at);
    if (found === -1) return null;

    // Adjacent characters are a much stronger signal than scattered ones.
    if (found === previous + 1) score += 8;
    // So is starting a word, which is where filenames begin.
    if (found === 0 || /[\\/\-_. ]/.test(lowerHay[found - 1] ?? '')) score += 6;
    // Exact case agreement breaks ties between otherwise equal candidates.
    if (haystack[found] === character && needle[indices.length] === character) score += 1;

    score += 1;
    indices.push(found);
    previous = found;
    at = found + 1;
  }

  // Prefer shorter haystacks and matches that start early.
  score -= Math.floor(haystack.length / 40);
  score -= Math.floor((indices[0] ?? 0) / 20);
  return { item: haystack, score, indices };
}

export function fuzzyFilter<T>(
  items: readonly T[],
  needle: string,
  toText: (item: T) => string,
  limit = 50,
): FuzzyMatch<T>[] {
  const results: FuzzyMatch<T>[] = [];

  for (const item of items) {
    const match = fuzzyScore(toText(item), needle);
    if (match === null) continue;
    results.push({ item, score: match.score, indices: match.indices });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
