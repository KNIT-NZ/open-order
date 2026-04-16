// lib/search-core.ts

export function cleanQuery(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export function deriveExactSectionKey(query: string): string | null {
  const cleaned = cleanQuery(query);

  const standingOrderMatch =
    cleaned.match(/^so\s*(\d+[a-z]?)$/i) ??
    cleaned.match(/^standing\s+order\s+(\d+[a-z]?)$/i);

  if (standingOrderMatch) {
    return `so-${standingOrderMatch[1].toLowerCase()}`;
  }

  const rulingMatch = cleaned.match(/^(\d+\/\d+)$/);
  if (rulingMatch) {
    return rulingMatch[1];
  }

  return null;
}

export function deriveExactCitationCompact(query: string): string | null {
  const cleaned = cleanQuery(query);

  const standingOrderMatch =
    cleaned.match(/^so\s*(\d+[a-z]?)$/i) ??
    cleaned.match(/^standing\s+order\s+(\d+[a-z]?)$/i);

  if (standingOrderMatch) {
    return `so${standingOrderMatch[1].toLowerCase()}`;
  }

  const rulingMatch = cleaned.match(/^(\d+\/\d+)$/);
  if (rulingMatch) {
    return rulingMatch[1].toLowerCase();
  }

  return null;
}

export function singularizeWord(word: string): string {
  if (word.length <= 3) return word;
  if (/ies$/i.test(word)) return word.replace(/ies$/i, "y");
  if (/sses$/i.test(word)) return word.replace(/es$/i, "");
  if (/ses$/i.test(word)) return word.replace(/es$/i, "");
  if (/s$/i.test(word) && !/ss$/i.test(word)) return word.replace(/s$/i, "");
  return word;
}

export function buildSingularizedPhrase(query: string): string | null {
  const cleaned = cleanQuery(query);
  if (!cleaned) return null;

  const singularized = cleaned
    .split(/\s+/)
    .map((word) => singularizeWord(word))
    .join(" ")
    .trim();

  if (!singularized) return null;
  if (singularized.toLowerCase() === cleaned.toLowerCase()) return null;

  return singularized;
}