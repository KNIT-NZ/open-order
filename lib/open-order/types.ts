// lib/open-order/types.ts
export type SearchResult = {
  sectionId: string;
  sectionKey: string;
  citationLabel: string;
  heading: string | null;
  headingHighlighted: string | null;
  path: string[];
  documentSlug: string;
  documentTitle: string;
  documentCorpus: string;
  sourceUrl: string | null;
  sourceAnchor: string | null;
  rank: number;
  sectionRank: number;
  chunkRank: number | null;
  sectionContent: string;
  sectionContentHighlighted?: string | null;
  matchSignals: {
    exactSectionKeyMatch: boolean;
    exactCitationMatch: boolean;
    exactHeadingMatch: boolean;
    headingPhraseMatch: boolean;
    bodyPhraseMatch: boolean;
  };
};

export type SearchResponse = {
  ok: boolean;
  query: string;
  corpus: string | null;
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
  latencyMs: number;
  results: SearchResult[];
};

export type ThemeMode = "light" | "dark";

export type AiPlan = {
  intent:
    | "explain_rule"
    | "explain_statement"
    | "options"
    | "admissibility"
    | "tactic"
    | "compare_authorities"
    | "clarification";
  preferredCorpus: "standing_orders" | "speakers_rulings" | null;
  searchQueries: string[];
  notes: string;
};

export type AiAuthority = {
  sectionId: string;
  sectionKey: string;
  citationLabel: string;
  heading: string | null;
  path: string[];
  documentSlug: string;
  documentTitle: string;
  documentCorpus: string;
  sourceUrl: string | null;
  sourceAnchor: string | null;
  sourceHref: string | null;
  rank: number;
  canonicalHref?: string;
};

export type AiDiagnosticTopResult = {
  sectionId: string;
  sectionKey: string;
  citationLabel: string;
  heading: string | null;
  documentTitle: string;
  documentCorpus: string;
  rank: number;
  sectionRank: number;
  pathRank: number;
  bodyRank: number;
  chunkRank: number | null;
  clusterSupportCount: number;
  matchSignals: {
    exactSectionKeyMatch: boolean;
    exactCitationMatch: boolean;
    exactHeadingMatch: boolean;
    headingPhraseMatch: boolean;
    bodyPhraseMatch: boolean;
    pathPhraseMatch?: boolean;
  };
};

export type AiDiagnosticRetrieval = {
  query: string;
  corpus: string | null;
  resultCount: number;
  topResults: AiDiagnosticTopResult[];
};

export type AiDiagnosticFinalAuthority = {
  query: string;
  citationLabel: string;
  heading: string | null;
  documentCorpus: string;
  baseRank: number;
  routeBoost: number;
  adjustedRank: number;
  path: string[];
};

export type AiDiagnosticsPayload = {
  effectiveCorpus: string | null;
  inferredConcepts?: string[];
  expandedQueries?: string[];
  retrievals: AiDiagnosticRetrieval[];
  finalAuthoritySelection?: AiDiagnosticFinalAuthority[];
};

export type AiDiagnostics = {
  question: string;
  requestedCorpus: string | null;
  effectiveCorpus: string | null;
  stageLabel: string | null;
  startedAt: string | null;
  latencyMs: number | null;
  plan: AiPlan | null;
  authorities: AiAuthority[];
  answerText: string;
  error: string | null;
  inferredConcepts: string[];
  expandedQueries: string[];
  retrievals: AiDiagnosticRetrieval[];
  finalAuthoritySelection: AiDiagnosticFinalAuthority[];
};

export const EMPTY_AI_DIAGNOSTICS: AiDiagnostics = {
  question: "",
  requestedCorpus: null,
  effectiveCorpus: null,
  stageLabel: null,
  startedAt: null,
  latencyMs: null,
  plan: null,
  authorities: [],
  answerText: "",
  error: null,
  inferredConcepts: [],
  expandedQueries: [],
  retrievals: [],
  finalAuthoritySelection: [],
};

export type UseOpenOrderAssistantReturn = {
  question: string;
  setQuestion: (value: string) => void;
  stageLabel: string | null;
  plan: AiPlan | null;
  authorities: AiAuthority[];
  answerText: string;
  error: string | null;
  isLoading: boolean;
  diagnostics: AiDiagnostics;
  copiedToken: string | null;
  setCopiedToken: (value: string | null) => void;
  debugSnapshot: string;
  hasDebugSnapshot: boolean;
  ask: (requestedCorpus: string | null) => Promise<void>;
};