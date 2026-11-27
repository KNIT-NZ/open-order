export function withCorpusCommitteeNames<T>(
  labels: Array<string | { name?: string; tokens?: string[]; sectionId?: string; citationLabel?: string; path?: string[] }>,
  run: () => T,
): T;
