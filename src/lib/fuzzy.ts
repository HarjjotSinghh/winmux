/**
 * Tiny subsequence fuzzy matcher for the command palette.
 * Pure and dependency-free so it stays unit-testable.
 */

/** Score a query against text; null when the query isn't a subsequence. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const t = text.toLowerCase();

  let qi = 0;
  let score = 0;
  let lastMatch = -2;
  let streak = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    if (ti === 0) {
      score += 10;
    } else if (/[\s\-_/:.]/.test(t[ti - 1])) {
      score += 6;
    }
    if (ti === lastMatch + 1) {
      streak += 1;
      score += 2 + Math.min(streak, 4);
    } else {
      streak = 0;
      score += 1;
    }
    lastMatch = ti;
    qi++;
  }
  if (qi < q.length) return null;
  // Shorter labels win ties.
  score += Math.max(0, 8 - (t.length - q.length) * 0.2);
  return score;
}

/** Keep matching items, best score first (stable for ties). */
export function fuzzyFilter<T>(query: string, items: T[], key: (item: T) => string): T[] {
  if (!query.trim()) return items;
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(query, key(item)) }))
    .filter((e): e is typeof e & { score: number } => e.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((e) => e.item);
}
