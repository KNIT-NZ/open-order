/** The only non-generated generic vocabulary besides determiners and "committee(s)". */
export const COMMITTEE_REFERENCE_WORDS: readonly string[];
export function foldCommitteeText(text: string): string;
export function extractCommitteeTokens(text: string): string[];
export function committeeNameTokens(text: string): string[];
export function isCommitteeHeadingPrefix(word: string): boolean;
export function isGenericCommitteePhrase(tokens: string[]): boolean;
export function nameShapedCommitteeText(text: string): boolean;
export function identifiesCorpusRecord(parsed: string[], record: string[]): boolean;
export type CommitteeNameRecord = {
  tokens: string[];
  sectionId?: string;
  citationLabel: string;
  path: string[];
};
export function committeeRecords(): CommitteeNameRecord[];
export function compileCommitteeLabels(
  labels: Array<string | { name?: string; tokens?: string[]; sectionId?: string; citationLabel?: string; path?: string[] }>,
): CommitteeNameRecord[];
export function installCommitteeRecordReader(reader: () => CommitteeNameRecord[] | null): void;
export function committeeRecordsFromSections(rows: Array<{
  sectionId?: string;
  id?: string;
  heading?: string | null;
  path?: string[] | null;
  citationLabel?: string;
  citation_label?: string;
}>): CommitteeNameRecord[];
