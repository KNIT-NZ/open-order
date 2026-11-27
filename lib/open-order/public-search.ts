import type { AiDiagnosticRetrieval } from "./types";

/** Planner query text stays on the server. The client sees a count and a matched-row flag. */
export function publicRetrievals(retrievals: readonly AiDiagnosticRetrieval[] | undefined): AiDiagnosticRetrieval[] {
  return (retrievals ?? []).map((search) => {
    const discovery = search.discovery;
    return {
      corpus: search.corpus,
      provenance: search.provenance,
      resultCount: search.resultCount,
      matchedRow: search.resultCount > 0,
      query: "",
      discovery: discovery ? {
        conceptId: discovery.conceptId,
        provenance: discovery.provenance,
        status: discovery.status,
        validation: discovery.validation,
        heading: null,
        evidenceCount: discovery.evidenceCount,
        slotKey: discovery.slotKey,
        query: "",
        bridgeMatched: Boolean(discovery.bridgeSourceQuery),
        bridgeSourceCitationLabel: null,
      } : undefined,
      topResults: search.topResults,
    };
  });
}
