export function foldCommitteeText(text: string): string;
export function extractCommitteeTokens(text: string): string[];
export function isGenericCommitteePhrase(tokens: string[]): boolean;
export function nameShapedCommitteeText(text: string): boolean;
export function sameCommitteeTokens(left: string[], right: string[]): boolean;
export type CommitteeNameRecord = {
  tokens: string[];
  sectionId: string;
  citationLabel: string;
  path: string[];
};
export function committeeRecords(): CommitteeNameRecord[];
export function withCorpusCommitteeNames<T>(
  labels: Array<string | { name?: string; tokens?: string[]; sectionId?: string; citationLabel?: string; path?: string[] }>,
  run: () => T,
): T;
export function committeeRecordsFromSections(rows: Array<{
  sectionId?: string;
  id?: string;
  heading?: string | null;
  path?: string[] | null;
  citationLabel?: string;
  citation_label?: string;
}>): CommitteeNameRecord[];
