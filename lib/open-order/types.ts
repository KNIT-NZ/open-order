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
  salientTerms?: string[];
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

export type AiQueryProvenance =
  | "planner"
  | "user_term"
  | "registry_expansion"
  | "corpus_bridge"
  | "recovery";

export type AiDiagnosticDiscovery = {
  conceptId: string;
  query: string;
  provenance: AiQueryProvenance;
  status: "promoted" | "rejected" | "covered_by_static" | "bound_to_promoted";
  validation: string;
  heading: string | null;
  evidenceCount: number;
  slotKey: string | null;
  bridgeSourceQuery?: string | null;
  bridgeSourceCitationLabel?: string | null;
  bridgeMatched?: boolean;
};

export type AiDiagnosticRetrieval = {
  query: string;
  matchedRow?: boolean;
  corpus: string | null;
  provenance?: AiQueryProvenance;
  discovery?: AiDiagnosticDiscovery;
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
  slotBoost?: number;
  preferredTextBoost?: number;
  bridgeBoost?: number;
  discoveryBoost?: number;
  adjustedRank: number;
  matchedSlots?: string[];
  authorityFunction?: string;
  path: string[];
};

export type AiDiagnosticSlotMatch = {
  slotKey: string;
  citationLabel: string;
  heading: string | null;
};

export type AiSourceDisposition = {
  citationLabel: string; corpus: string; status: string; reason: string; role: string | null;
};
export type AiScenarioAdjudication = {
  status: string; candidateCount: number; selected: string[]; rejected: string[];
  gaps: string[]; providerAttempts: number; dossier: string[]; retrievedOutsideDossier: string[];
  dispositions: AiSourceDisposition[]; dispositionCounts?: string[]; unavailableNominations: number;
  recovery: { status: string; candidates: string[]; dispositions: AiSourceDisposition[];
    dispositionCounts?: string[]; unavailableNominations: number; selected: string[]; rejected: string[] };
};

export type AiSelectorSummary = {
  scenarioAdjudication?: AiScenarioAdjudication;
  candidateCount: number;
  minObligationCoverage: number;
  allObligationsComplete: boolean;
  obligationDetails: Array<{ coverage: number; complete: boolean }>;
  prePruneLabels?: string[];
  prePruneCount?: number;
  legacySelectedCount?: number;
  selectedLabels: string[];
};

export type AiPipelineTrace = {
  schemaVersion: 2;
  incidentRepair?: string | null;
  requestId: string;
  buildCommit: string | null;
  stageTimeline: Array<{ key: string; label: string; atMs: number }>;
};

export type AiTerminalValidation = {
  degraded: boolean;
  fallbackReason: string | null;
  rewriteNote: string | null;
  pruneNote: string | null;
  claimValidationNote: string | null;
  invalidCitations: string[];
};

export type AiDiagnosticsPayload = {
  effectiveCorpus: string | null;
  inferredConcepts?: string[];
  expandedQueries?: string[];
  blueprintSlots?: string[];
  requiredSlots?: string[];
  optionalSlots?: string[];
  satisfiedSlots?: string[];
  missingRequiredSlots?: string[];
  blueprintSatisfied?: boolean;
  selectedSlotMatches?: AiDiagnosticSlotMatch[];
  retrievals: AiDiagnosticRetrieval[];
  finalAuthoritySelection?: AiDiagnosticFinalAuthority[];
  selectorSummary?: AiSelectorSummary;
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
  expandedQueryCount?: number;
  blueprintSlots: string[];
  requiredSlots: string[];
  optionalSlots: string[];
  satisfiedSlots: string[];
  missingRequiredSlots: string[];
  blueprintSatisfied: boolean | null;
  selectedSlotMatches: AiDiagnosticSlotMatch[];
  retrievals: AiDiagnosticRetrieval[];
  finalAuthoritySelection: AiDiagnosticFinalAuthority[];
  selectorSummary: AiSelectorSummary | null;
  pipelineTrace: AiPipelineTrace | null;
  terminalValidation: AiTerminalValidation | null;
  errorKind: string | null;
  errorRetryable: boolean | null;
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
  blueprintSlots: [],
  requiredSlots: [],
  optionalSlots: [],
  satisfiedSlots: [],
  missingRequiredSlots: [],
  blueprintSatisfied: null,
  selectedSlotMatches: [],
  retrievals: [],
  finalAuthoritySelection: [],
  selectorSummary: null,
  pipelineTrace: null,
  terminalValidation: null,
  errorKind: null,
  errorRetryable: null,
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
  progressValue: number;
  diagnostics: AiDiagnostics;
  copiedToken: string | null;
  setCopiedToken: (value: string | null) => void;
  debugSnapshot: string;
  hasDebugSnapshot: boolean;
  ask: (requestedCorpus: string | null) => Promise<void>;
};