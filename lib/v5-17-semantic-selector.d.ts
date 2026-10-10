import type { ProceduralSearchResult } from "./procedural-search";

export type V517QueryProvenance =
  | "planner"
  | "user_term"
  | "registry_expansion"
  | "corpus_bridge"
  | "recovery"
  | "structural"
  | string;

export type V517SearchExecution = {
  query: string;
  corpus: string | null;
  provenance?: V517QueryProvenance;
  results: ProceduralSearchResult[];
};

export type V517SearchResponse = {
  results: ProceduralSearchResult[];
  total: number | string;
};

export type V517SearchFunction = (input: {
  q: string;
  corpus: string | null;
  limit: number;
  offset: number;
  includeDebug: boolean;
}) => Promise<V517SearchResponse>;

export type V517ObligationDetail = {
  coverage: number;
  complete: boolean;
};

export type V517PrunedAuthority = {
  citationLabel: string;
  evidenceLoss: number;
};

export type V517SelectionResult = {
  finalAuthorities: ProceduralSearchResult[];
  prePruneLabels: string[];
  selectedLabels: string[];
  prunedRedundant: V517PrunedAuthority[];
  minObligationCoverage: number;
  allObligationsComplete: boolean;
  obligationDetails: V517ObligationDetail[];
  candidateCount: number;
};

export function selectV517AuthorityPack(input: {
  question: string;
  searches: V517SearchExecution[];
  searchProceduralAuthorities: V517SearchFunction;
  maxAuthorities?: number;
}): Promise<V517SelectionResult>;
