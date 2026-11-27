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

/** Counts only. key=code:count, with no labels and no prose. */
export function forumCountCodes(
  prefix: "selector_forum" | "overlooked_forum",
  counts: { identity?: number; ambiguous?: number },
): string[] {
  const identity = Math.max(0, Math.trunc(Number(counts?.identity) || 0));
  const ambiguous = Math.max(0, Math.trunc(Number(counts?.ambiguous) || 0));
  const tokens = [
    `${prefix}=forum-identity:${identity}`,
    `${prefix}=forum-ambiguous:${ambiguous}`,
  ];
  return clientCheckNote(tokens)?.split(";") ?? [];
}
