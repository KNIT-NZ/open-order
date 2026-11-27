const PUBLIC_NOTE = /^[a-z0-9_.=:+,-]{1,160}$/i;

/**
 * Text that may reach the client: counts, claim ids and fixed codes.
 * Model prose, authority labels and pruned excerpts do not match.
 */
export function clientCheckNote(parts: Array<string | null | undefined>): string | null {
  const kept: string[] = [];
  for (const part of parts) {
    for (const piece of String(part ?? "").split(";")) {
      const token = piece.trim();
      if (!PUBLIC_NOTE.test(token) || kept.includes(token)) continue;
      kept.push(token);
    }
  }
  return kept.length > 0 ? kept.join(";") : null;
}
