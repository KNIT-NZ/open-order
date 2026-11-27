import {
  forumIdentityMismatch,
  procedureHomonymMismatch,
  quoteAttestsActAndObject,
} from "@/lib/procedural-mechanisms";

/**
 * Open Order v40: source-adjudication contracts, candidate diversity and evidence gates.
 * No authority IDs, benchmark answers or preferred rulings are embedded here.
 * Model proposals are untrusted until validated against exact retrieved source text.
 */
export type V40Authority = {
  sectionId: string;
  citationLabel: string;
  documentCorpus: string;
  heading?: string | null;
  path: string[];
  sectionContent: string;
  rank?: number;
};
export type V40Search<T extends V40Authority> = {
  query: string;
  corpus: string | null;
  provenance?: string;
  results: T[];
};
export type V40Situation = {
  kind: "incident" | "procedure";
  actor: string;
  setting: string;
  action: string;
  affectedPerson: string;
  proceduralMoment: string;
  decisionQuestion: string;
  materialFacts: string[];
  evidenceQueries: string[];
};
/** Retrieve the authorising rule for a structured regulated act. */
export function v401MaterialEvidenceQueries(action?: string | null): string[] {
  const text = String(action ?? "").replace(/\s+/g, " ").trim();
  if (text.length < 3 || text.length > 90) return [];
  return [text];
}

function v401MediaWitnessMatches(action: string | undefined, quote: string): boolean {
  if (!action) return true;
  return quoteAttestsActAndObject(quote, action);
}

export function v401AcceptIndependentRepair(input: {
  claimIds: string[];
  validatedClaims: Array<{id:string; supported:boolean}>;
  responsive: boolean;
  unaddressedParts: string[];
  hasBottomLine: boolean;
  citationValid: boolean;
  mentionValid: boolean;
  sourceQualificationVetoes: number;
}): boolean {
  const ids = new Set(input.claimIds);
  return input.hasBottomLine && input.citationValid && input.mentionValid &&
    input.sourceQualificationVetoes === 0 && input.responsive &&
    input.unaddressedParts.length === 0 &&
    input.claimIds.length > 0 && ids.size === input.claimIds.length &&
    input.validatedClaims.length === input.claimIds.length &&
    input.validatedClaims.every((claim) => ids.has(claim.id) && claim.supported) &&
    new Set(input.validatedClaims.map((claim) => claim.id)).size === input.validatedClaims.length;
}

export type V40ProposedWitness = {
  citationLabel: string;
  role: "governing" | "qualification" | "implementation";
  exactQuote: string;
  actorMatches: boolean;
  settingMatches: boolean;
  actionMatches: boolean;
  stageMatches: boolean;
  rationale: string;
};
export type V40Adjudication = {
  selected: V40ProposedWitness[];
  remainingUncertainties: string[];
  explanation: string;
};
export type RejectedGoverningNomination = { id: string; inDossier: boolean };
export type V40Review<T extends V40Authority> = {
  authorities: T[];
  rejected: string[];
  accepted: string[];
  gaps: string[];
  reason: string;
  dispositions: V402Disposition[];
  unavailableNominations: number;
  /** Soft gates. act_attestation_unconfirmed admits the source and caps the answer. */
  qualifications: string[];
  /** Identifiers only. No adjudicator prose, quotes, or question text. */
  rejectedGoverning: RejectedGoverningNomination[];
};

const COMMON = new Set([
  "a", "an", "the", "of", "to", "and", "in", "or", "on", "at", "for", "by", "is", "are", "be", "do", "does", "can", "could", "would", "should", "with", "as", "it", "their", "them", "that", "this", "there", "what", "which", "when", "where", "who", "how", "from", "during", "after", "before", "about", "under", "into", "members", "member", "parliament", "parliamentary", "speaker", "house", "rules", "ruling", "order", "procedure", "proceedings",
]);
function words(input: string): Set<string> {
  return new Set(input.toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/(?:ing|ed|es|s)$/,""))
    .filter((word) => word.length >= 3 && !COMMON.has(word)));
}
function intersection(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const value of a) if (b.has(value)) count += 1;
  return count;
}
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Diverse, deterministic SOURCE DISCOVERY, never a source-validity decision.
 * Round-robin top results from separate searches so large heading clusters
 * cannot bury later evidence dimensions. Exact model citations are still checked.
 */
export function buildV40Dossier<T extends V40Authority>(input: {
  question: string;
  searches: V40Search<T>[];
  legacySelected: T[];
  max?: number;
}): T[] {
  const max = Math.max(8, Math.min(40, input.max ?? 32));
  const result = new Map<string, T>();
  const insert = (source: T): void => {
    if (!source || !source.sectionId || !source.citationLabel ||
        !source.sectionContent?.trim() ||
        !["standing_orders", "speakers_rulings"].includes(source.documentCorpus)) return;
    result.set(`${source.documentCorpus}:${source.citationLabel}`, source);
  };
  input.legacySelected.forEach((source) => {
    if (result.size < max) insert(source);
  });
  // v40.2.1: preserve the original retrieval leaders for the first three
  // planner dimensions before the lexical diversity rerank. This is only a
  // bounded opportunity to be reviewed, not a source admission or boost.
  // Incidental user-term/bridge searches must not consume this reservation.
  const primarySearches = input.searches.filter((search) => search.provenance === "planner").slice(0, 3);
  for (let rank = 0; rank < 2; rank += 1) {
    for (const search of primarySearches) {
      if (result.size >= max) break;
      const source = search.results[rank];
      if (source) insert(source);
    }
  }
  const question = words(input.question);
  const queues = input.searches.map((search) => {
    const query = words(search.query);
    const ranked = [...search.results].map((source, index) => {
      const heading = words(`${source.heading ?? ""} ${(source.path ?? []).join(" ")}`);
      const body = words(source.sectionContent.slice(0, 1800));
      const headingAffinity = intersection(query, heading);
      const questionAffinity = intersection(question, heading);
      const bodyAffinity = intersection(question, body);
      // Source ranking is local to each search. No cross-query rank comparison.
      return { source, index, score: headingAffinity * 3 + questionAffinity * 2 +
        Math.min(bodyAffinity, 7) * 0.4 - index * 0.01 };
    }).sort((a,b)=>b.score-a.score || a.index-b.index);
    // Retain a few independently discovered results even if they share a heading.
    return ranked.slice(0, 8).map((item)=>item.source);
  });
  let cursor = 0;
  while(result.size < max && queues.some((queue)=>queue.length>cursor)) {
    for (const queue of queues) {
      if (result.size >= max) break;
      if (queue[cursor]) insert(queue[cursor]);
    }
    cursor += 1;
  }
  return [...result.values()].slice(0,max);
}

export function v40SourceScopeMismatch(question: string, source: V40Authority, setting?: string): string | null {
  const homonym = procedureHomonymMismatch(question, source.heading ?? "");
  if (homonym) return homonym;
  const forum = forumIdentityMismatch(setting || "", source.path ?? []);
  if (forum) return forum;
  return null;
}

export type V402Disposition = {
  citationLabel: string;
  corpus: string;
  status: "not_nominated" | "rejected" | "admitted" | "withheld_no_primary" | "not_reviewed_limit";
  reason: string;
  role: V40ProposedWitness["role"] | null;
};

export function validateV40Proposal<T extends V40Authority>(input: {
  question: string;
  candidates: T[];
  proposal: V40Adjudication;
  limit?: number;
  setting?: string;
  action?: string;
}): V40Review<T> {
  const limit = Math.max(1, Math.min(4, input.limit ?? 4));
  const byLabel = new Map<string, T>();
  const ambiguous = new Set<string>();
  for (const source of input.candidates) {
    const prior = byLabel.get(source.citationLabel);
    if (prior && prior.sectionId !== source.sectionId) ambiguous.add(source.citationLabel);
    byLabel.set(source.citationLabel, source);
  }
  const dispositions: V402Disposition[] = input.candidates.map((source) => ({
    citationLabel: source.citationLabel, corpus: source.documentCorpus,
    status: "not_nominated", reason: "model_did_not_nominate", role: null,
  }));
  const rejected: string[] = [];
  const accepted: string[] = [];
  const authorities: T[] = [];
  const qualifications: string[] = [];
  const rejectedGoverning: RejectedGoverningNomination[] = [];
  let primaryAdmitted = false;
  let unavailableNominations = 0;
  const seen = new Set<string>();
  const noteRejectedGoverning = (item: V40ProposedWitness, source: T | undefined) => {
    if (item.role !== "governing") return;
    const sectionId = source?.sectionId ?? "";
    const label = (source?.citationLabel || item.citationLabel || "").trim();
    const id = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,64}$/.test(sectionId)
      ? sectionId
      : (/^(?:SO\s+\d+[A-Za-z]*|\d+\/\d+)$/i.test(label) ? label : "");
    if (!id || rejectedGoverning.some((row) => row.id === id)) return;
    rejectedGoverning.push({ id, inDossier: Boolean(source) });
  };
  for (const item of input.proposal.selected.slice(0, 12)) {
    const source = byLabel.get(item.citationLabel);
    if (!source) { unavailableNominations += 1; rejected.push("unknown-source:unavailable-or-duplicate"); continue; }
    const rows = dispositions.filter((row) => row.citationLabel === source.citationLabel);
    if (seen.has(item.citationLabel)) {
      rejected.push(`${source.citationLabel}:unavailable-or-duplicate`);
      continue;
    }
    seen.add(item.citationLabel);
    const mark = (status: V402Disposition["status"], reason: string) => {
      for (const row of rows) { row.status = status; row.reason = reason; row.role = item.role; }
      if (status === "rejected") {
        rejected.push(`${source.citationLabel}:${reason}`);
        noteRejectedGoverning(item, source);
      }
    };
    if (ambiguous.has(item.citationLabel)) { mark("rejected", "ambiguous-source-identity"); continue; }
    if (authorities.length >= limit) { mark("not_reviewed_limit", "admission_limit"); continue; }
    if (!(item.actorMatches && item.settingMatches && item.actionMatches && item.stageMatches)) {
      const failed = [!item.actorMatches && "actor", !item.settingMatches && "setting",
        !item.actionMatches && "action", !item.stageMatches && "stage"].filter(Boolean).join(",");
      mark("rejected", `scope-not-established:${failed}`); continue;
    }
    const mismatch = v40SourceScopeMismatch(input.question, source, input.setting);
    if (mismatch) { mark("rejected", mismatch); continue; }
    const quote = normalizeWhitespace(item.exactQuote);
    if (quote.length < 24 || !normalizeWhitespace(source.sectionContent).includes(quote)) {
      mark("rejected", "unverified-verbatim-witness"); continue;
    }
    if (!["governing", "qualification", "implementation"].includes(item.role)) {
      mark("rejected", "invalid-source-role"); continue;
    }
    // A lexical act miss is not a defective authority. Admit it and qualify.
    const actUnconfirmed = item.role === "governing" && !v401MediaWitnessMatches(input.action, quote);
    authorities.push(source);
    accepted.push(source.citationLabel);
    if (actUnconfirmed) {
      if (!qualifications.includes("act_attestation_unconfirmed")) qualifications.push("act_attestation_unconfirmed");
      mark("admitted", "act_attestation_unconfirmed");
    } else {
      mark("admitted", "verified_source_witness");
    }
    if (item.role === "governing") primaryAdmitted = true;
  }
  for (const item of input.proposal.selected) {
    if (item.role !== "governing" || byLabel.has(item.citationLabel)) continue;
    noteRejectedGoverning(item, undefined);
  }
  if (!primaryAdmitted) {
    for (const row of dispositions) if (row.status === "admitted") {
      row.status = "withheld_no_primary"; row.reason = "missing-primary-governing-witness";
    }
    return { authorities: [], accepted: [], rejected: [...rejected, "missing-primary-governing-witness"],
      gaps: input.proposal.remainingUncertainties.slice(0, 5), reason: "v40_no_governing_witness",
      dispositions, unavailableNominations, qualifications, rejectedGoverning };
  }
  return { authorities, accepted, rejected, gaps: input.proposal.remainingUncertainties.slice(0, 5),
    reason: "v40_quoted_source_adjudication", dispositions, unavailableNominations, qualifications, rejectedGoverning };
}

/** A second review may reconsider omitted or previously non-governing sources,
 * never any source with a failed deterministic or model scope check. */
export function v402RecoveryCandidates<T extends V40Authority>(input: {
  question: string; candidates: T[]; review: V40Review<T>;
}): T[] {
  if (input.review.reason !== "v40_no_governing_witness") return [];
  const dispositions = new Map(input.review.dispositions.map((row) => [row.citationLabel, row]));
  const rejected = new Set(input.review.rejected.map((entry) => entry.split(":")[0]));
  return input.candidates.filter((source) => {
    const row = dispositions.get(source.citationLabel);
    return !!row && !rejected.has(source.citationLabel) &&
      (row.status === "not_nominated" || row.status === "withheld_no_primary") &&
      !v40SourceScopeMismatch(input.question, source);
  });
}

/** Diagnostic projection of the existing repair gate, without relaxing it. */
export function v402RepairRefusals(input: Parameters<typeof v401AcceptIndependentRepair>[0]): string[] {
  const reasons: string[] = [];
  if (!input.hasBottomLine) reasons.push("missing_bottom_line");
  if (!input.citationValid) reasons.push("invalid_citations");
  if (!input.mentionValid) reasons.push("invalid_authority_mentions");
  if (input.sourceQualificationVetoes !== 0) reasons.push("qualification_veto");
  if (!input.responsive) reasons.push("not_responsive_or_missing_verdict");
  if (input.unaddressedParts.length) reasons.push("unaddressed_parts");
  const ids = new Set(input.claimIds);
  const verdictIds = new Set(input.validatedClaims.map((claim) => claim.id));
  if (!ids.size) reasons.push("no_claims");
  if (ids.size !== input.claimIds.length) reasons.push("duplicate_claim_ids");
  if (input.validatedClaims.length !== input.claimIds.length) reasons.push("verdict_count_mismatch");
  if (verdictIds.size !== input.validatedClaims.length) reasons.push("duplicate_verdict_ids");
  if (input.validatedClaims.some((claim) => !ids.has(claim.id))) reasons.push("unexpected_verdict_id");
  if ([...ids].some((id) => !verdictIds.has(id))) reasons.push("missing_claim_verdict");
  if (input.validatedClaims.some((claim) => !claim.supported)) reasons.push("unsupported_claim");
  return reasons;
}

/** Overlooked text is admitted only when an external judge returns a proposal that passes the same witness checks. */
export async function admitJudgedOverlooked<T extends V40Authority>(input: {
  question: string;
  setting?: string;
  action?: string;
  candidates: T[];
  judge: () => Promise<V40Adjudication>;
}): Promise<{ authorities: T[]; unavailable: boolean; qualifications: string[] }> {
  if (input.candidates.length === 0) return { authorities: [], unavailable: false, qualifications: [] };
  try {
    const proposal = await input.judge();
    const review = validateV40Proposal({
      question: input.question,
      setting: input.setting,
      action: input.action,
      candidates: input.candidates,
      proposal,
    });
    return { authorities: review.authorities, unavailable: false, qualifications: review.qualifications };
  } catch {
    return { authorities: [], unavailable: true, qualifications: [] };
  }
}

export type AdjudicationRouteReason =
  | "no_legacy_pack"
  | "planner_procedure"
  | "incident_corroborated"
  | "incident_uncorroborated"
  | "narrative_corroborated"
  | "kind_absent";

type RoutingSituation = {
  materialFacts?: string[] | null;
  affectedPerson?: string | null;
} | null | undefined;

/** The planner recorded an occurrence. No question-opening list and no framing-word test. */
export function plannerRecordsEvent(situation: RoutingSituation): boolean {
  const facts = situation?.materialFacts;
  const affected = String(situation?.affectedPerson ?? "").trim();
  return affected.length > 0 || (Array.isArray(facts) && facts.some((fact) => String(fact ?? "").trim().length > 0));
}

/**
 * Quoted-source adjudication requires a structured event from the planner.
 * kind=incident alone stays on the selector. Adjudication remains the secondary path.
 */
export function adjudicationRouting(_question: string, kind: string | undefined, hasLegacy: boolean,
  situation?: RoutingSituation): {
  adjudicate: boolean;
  reason: AdjudicationRouteReason;
} {
  if (!hasLegacy) return { adjudicate: true, reason: "no_legacy_pack" };
  if (kind === "procedure") return { adjudicate: false, reason: "planner_procedure" };
  const recorded = plannerRecordsEvent(situation);
  if (kind === "incident") {
    return recorded
      ? { adjudicate: true, reason: "incident_corroborated" }
      : { adjudicate: false, reason: "incident_uncorroborated" };
  }
  if (recorded) return { adjudicate: true, reason: "narrative_corroborated" };
  return { adjudicate: false, reason: "kind_absent" };
}

export function v40MustAdjudicate(question: string, kind: V40Situation["kind"] | undefined,
  hasLegacy: boolean, situation?: RoutingSituation): boolean {
  return adjudicationRouting(question, kind, hasLegacy, situation).adjudicate;
}
