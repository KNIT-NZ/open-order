// lib/procedural-reasoning.ts
import type { ProceduralSearchResult } from "@/lib/procedural-search";
import { cleanQuery } from "@/lib/search-core";
import { citationTokenMatchesLabel, citationTokensInBrackets, conceptsMatchingLabels, usableSourceAnchor } from "@/lib/procedural-mechanisms";
import {
  CONCEPT_REGISTRY,
  type AuthorityExclusionSpec,
  type AuthoritySlotSpec,
  type ProceduralConcept,
} from "./concept-registry";
import {
  selectV517AuthorityPack,
  type V517SearchFunction,
  type V517SelectionResult,
} from "./v5-17-semantic-selector.js";

export type QueryProvenance =
  | "planner"
  | "user_term"
  | "registry_expansion"
  | "corpus_bridge"
  | "recovery";

export type SearchDimension = {
  query: string;
  provenance: QueryProvenance;
};

export type DiscoveredProceduralDimension = {
  conceptId: string;
  query: string;
  provenance: QueryProvenance;
  status: "promoted" | "rejected" | "covered_by_static" | "bound_to_promoted";
  validation: string;
  heading: string | null;
  evidenceCount: number;
  slotKey: string | null;
  bridgeSourceQuery: string | null;
  bridgeSourceCitationLabel: string | null;
};

export type SearchExecution = {
  query: string;
  corpus: string | null;
  provenance?: QueryProvenance;
  bridgeSourceQuery?: string;
  bridgeSourceCitationLabel?: string;
  results: ProceduralSearchResult[];
};

export type AuthorityClass =
  | "governing_rule"
  | "chair_control"
  | "procedural_mechanism"
  | "constraint_or_qualification"
  | "analogy_or_support"
  | "miscellaneous";

export type AuthorityFunction =
  | "rule"
  | "procedure"
  | "constraint"
  | "exception"
  | "application"
  | "effect"
  | "context";

export type AuthorityProfile = {
  pathText: string;
  heading: string;
  isCommitteeOfWhole: boolean;
  isCommitteeStage: boolean;
  isRulesOfDebate: boolean;
  isPersonalReflections: boolean;
  isAgainstMembers: boolean;
  isAllegationsOfRacism: boolean;
  isChairperson: boolean;
  isPointsOfOrder: boolean;
  isRelevancy: boolean;
  isSelectCommitteeChairpersons: boolean;
  isClosure: boolean;
  isAcceptance: boolean;
  isEffect: boolean;
  authorityClass: AuthorityClass;
  authorityFunction: AuthorityFunction;
};

export type ScoredAuthority = {
  result: ProceduralSearchResult;
  query: string;
  queryIndex: number;
  routeBoost: number;
  slotBoost: number;
  preferredTextBoost: number;
  bridgeBoost: number;
  discoveryBoost: number;
  adjustedRank: number;
  matchedSlotKeys: string[];
};

type DerivedFrame = {
  activeConcepts: ProceduralConcept[];
  committeeOfWhole: boolean;
  memberConduct: boolean;
  closure: boolean;
  relevancy: boolean;
  ministerialAccountability: boolean;
  retrospectiveDiscipline: boolean;
};

type SlotMatch = {
  slotKey: string;
  citationLabel: string;
  heading: string | null;
};

export type CorpusBridgeSearchRequest = {
  query: string;
  corpus: "standing_orders" | "speakers_rulings" | null;
  sourceQuery: string;
  sourceProvenance: "planner" | "user_term";
  sourceCitationLabel: string;
};

export type RecoverySearchRequest = {
  slotKey: string;
  query: string;
  corpus: "standing_orders" | "speakers_rulings" | null;
};

export type MissingEvidenceGap = {
  slotKey: string;
  description: string;
};

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function firstWords(text: string, wordCount = 10): string {
  return normalizeWhitespace(text)
    .split(" ")
    .filter(Boolean)
    .slice(0, wordCount)
    .join(" ");
}

export function buildSourceHref(
  result: Pick<
    ProceduralSearchResult,
    "sourceUrl" | "sourceAnchor" | "sectionContent"
  >,
): string | null {
  if (!result.sourceUrl) return null;

  const content = normalizeWhitespace(result.sectionContent);
  const textStart = firstWords(content, 10) || null;
  const baseUrl = result.sourceUrl.split("#")[0];
  if (/\.docx$/i.test(baseUrl)) return baseUrl;
  const anchorValue = usableSourceAnchor(result.sourceAnchor);
  const anchor = anchorValue ? encodeURI(anchorValue) : null;

  if (textStart && anchor) {
    return `${baseUrl}#${anchor}:~:text=${encodeURIComponent(textStart)}`;
  }

  if (textStart) {
    return `${baseUrl}#:~:text=${encodeURIComponent(textStart)}`;
  }

  if (anchor) {
    return `${baseUrl}#${anchor}`;
  }

  return baseUrl;
}

export function buildAuthorityPayload(results: ProceduralSearchResult[]) {
  return results.map((result) => ({
    sectionId: result.sectionId,
    sectionKey: result.sectionKey,
    citationLabel: result.citationLabel,
    heading: result.heading,
    path: result.path,
    documentSlug: result.documentSlug,
    documentTitle: result.documentTitle,
    documentCorpus: result.documentCorpus,
    sourceUrl: result.sourceUrl,
    sourceAnchor: usableSourceAnchor(result.sourceAnchor),
    sourceHref: buildSourceHref(result),
    rank: result.rank,
  }));
}

function normalizeConceptTrigger(text: string): string {
  return cleanQuery(text).toLowerCase();
}

function addPlannerTriggeredConcepts(
  matched: Map<string, ProceduralConcept>,
  plannerQueries: string[],
): void {
  const normalizedQueries = new Set(
    plannerQueries.map(normalizeConceptTrigger).filter(Boolean),
  );

  if (normalizedQueries.size === 0) return;

  for (const concept of CONCEPT_REGISTRY) {
    const triggers = concept.plannerTriggers ?? [];
    if (
      triggers.some((trigger) =>
        normalizedQueries.has(normalizeConceptTrigger(trigger)),
      )
    ) {
      matched.set(concept.id, concept);
    }
  }
}

export function inferConcepts(
  _question: string,
  plannerQueries: string[] = [],
): ProceduralConcept[] {
  const matched = new Map<string, ProceduralConcept>();
  for (const concept of conceptsMatchingLabels(CONCEPT_REGISTRY, plannerQueries) as ProceduralConcept[]) {
    matched.set(concept.id, concept);
  }
  addPlannerTriggeredConcepts(matched, plannerQueries);
  return [...matched.values()];
}

function deriveFrame(
  question: string,
  plannerQueries: string[] = [],
): DerivedFrame {
  const activeConcepts = inferConcepts(question, plannerQueries);
  const ids = new Set(activeConcepts.map((c) => c.id));

  return {
    activeConcepts,
    committeeOfWhole: ids.has("committee_of_whole"),
    memberConduct:
      ids.has("personal_reflection") || ids.has("allegation_of_racism"),
    closure: ids.has("closure_motion"),
    relevancy: ids.has("relevancy"),
    ministerialAccountability: ids.has("ministerial_accountability"),
    retrospectiveDiscipline: ids.has("retrospective_discipline"),
  };
}

function canonicalizeProceduralQuery(query: string): string[] {
  const q = cleanQuery(query);
  return q ? [q] : [];
}

function addSearchDimension(
  output: SearchDimension[],
  seen: Set<string>,
  rawQuery: string,
  provenance: QueryProvenance,
): void {
  const query = cleanQuery(rawQuery);
  if (!query) return;

  const key = query.toLowerCase();
  if (seen.has(key)) return;

  seen.add(key);
  output.push({ query, provenance });
}

function addCanonicalExpansions(
  output: SearchDimension[],
  seen: Set<string>,
  rawQuery: string,
): void {
  const literal = cleanQuery(rawQuery).toLowerCase();

  for (const candidate of canonicalizeProceduralQuery(rawQuery)) {
    const normalized = cleanQuery(candidate);
    if (!normalized || normalized.toLowerCase() === literal) continue;
    addSearchDimension(output, seen, normalized, "registry_expansion");
  }
}

export function derivePostStagePathwayQueries(_question: string): string[] {
  return [];
}

// Map requests about legal recourse for parliamentary speech to the consequence
// expressed in governing authority text; no citation IDs or answer labels here.
export function deriveLegalEffectQueries(_question: string): string[] {
  return [];
}

// Narrowly retrieve the corpus-native procedural error rule when a user asks
// about a second vote because of a disputed count or claimed error. The query
// is not a citation or a positive entitlement; the selector remains decisive.
export function deriveVoteErrorQueries(_question: string): string[] {
  return [];
}

export function buildProceduralQueryPlan(input: {
  question: string;
  plannerQueries: string[];
  salientTerms?: string[];
  effectiveCorpus: string | null;
}): SearchDimension[] {
  const frame = deriveFrame(input.question, input.plannerQueries);
  const conceptQueries = frame.activeConcepts.flatMap((c) => c.preferredQueries);
  const additions: string[] = [];

  if (frame.closure) {
    additions.push("closure motion", "acceptance of closure motion");
  }

  if (frame.memberConduct) {
    additions.push("personal reflections", "against members");
    if (
      frame.activeConcepts.some((c) => c.id === "allegation_of_racism")
    ) {
      additions.push("allegations of racism");
    }
  }

  if (frame.committeeOfWhole) {
    additions.push("chairperson");
  }

  if (frame.relevancy) {
    additions.push("relevancy");
  }

  if (
    frame.activeConcepts.some((c) => c.id === "point_of_order") ||
    frame.closure ||
    frame.committeeOfWhole ||
    frame.ministerialAccountability ||
    frame.retrospectiveDiscipline
  ) {
    additions.push("point of order");
  }

  if (frame.ministerialAccountability) {
    additions.push("accountability to the House", "form of reply");
  }

  if (frame.retrospectiveDiscipline) {
    additions.push("withdrawal", "procedure");
  }

  const output: SearchDimension[] = [];
  const seen = new Set<string>();

  for (const query of input.plannerQueries) {
    addSearchDimension(output, seen, query, "planner");
  }

  for (const term of input.salientTerms ?? []) {
    addSearchDimension(output, seen, term, "user_term");
  }

  for (const query of input.plannerQueries) {
    addCanonicalExpansions(output, seen, query);
  }

  for (const term of input.salientTerms ?? []) {
    addCanonicalExpansions(output, seen, term);
  }

  for (const query of [...conceptQueries, ...additions]) {
    addSearchDimension(output, seen, query, "registry_expansion");
  }

  for (const query of derivePostStagePathwayQueries(input.question)) {
    addSearchDimension(output, seen, query, "registry_expansion");
  }

  for (const query of deriveLegalEffectQueries(input.question)) {
    addSearchDimension(output, seen, query, "registry_expansion");
  }

  for (const query of deriveVoteErrorQueries(input.question)) {
    addSearchDimension(output, seen, query, "registry_expansion");
  }

  return output.slice(0, 8);
}

export function expandPlannerQueries(input: {
  question: string;
  plannerQueries: string[];
  salientTerms?: string[];
  effectiveCorpus: string | null;
}): string[] {
  return buildProceduralQueryPlan(input).map((dimension) => dimension.query);
}


export function buildAuthorityProfile(
  result: ProceduralSearchResult,
): AuthorityProfile {
  const pathText = result.path.join(" > ").toLowerCase();
  const heading = (result.heading ?? "").toLowerCase();

  const isCommitteeOfWhole = pathText.includes("committees of the whole house");
  const isCommitteeStage =
    pathText.includes("committee stage") || pathText.includes("amendments");
  const isRulesOfDebate = pathText.includes("rules of debate");
  const isPersonalReflections = pathText.includes("personal reflections");
  const isAgainstMembers = heading === "against members";
  const isAllegationsOfRacism = heading === "allegations of racism";
  const isChairperson = heading === "chairperson";
  const isPointsOfOrder = heading === "points of order" || heading === "point of order";
  const isRelevancy = heading === "relevancy" || pathText.includes("relevancy");
  const isSelectCommitteeChairpersons =
    pathText.includes("chairpersons of select committees") ||
    pathText.includes("questions to other members");
  const isClosure =
    heading.includes("closure") || pathText.includes("closure of debate");
  const isAcceptance =
    heading.includes("acceptance") ||
    pathText.includes("acceptance of closure motion");
  const isEffect =
    heading.includes("effect") || pathText.includes("effect of carrying");

  let authorityClass: AuthorityClass = "miscellaneous";

  if (isPointsOfOrder) {
    authorityClass = "procedural_mechanism";
  } else if (isChairperson) {
    authorityClass = "chair_control";
  } else if (
    isAcceptance ||
    isEffect ||
    heading === "procedure" ||
    heading === "form of reply" ||
    heading === "withdrawal"
  ) {
    authorityClass = "constraint_or_qualification";
  } else if (
    isAgainstMembers ||
    isAllegationsOfRacism ||
    isRelevancy ||
    isClosure ||
    heading === "accountability to the house"
  ) {
    authorityClass = "governing_rule";
  } else if (isRulesOfDebate || isCommitteeStage || isPersonalReflections) {
    authorityClass = "analogy_or_support";
  }

  const content = result.sectionContent.toLowerCase();
  const exceptionSignals = [
    "nothing to prevent",
    "does not prevent",
    "not prohibited",
    "may be made as long as",
    "may be referred to",
    "cannot see that i should rule out",
  ];
  const constraintSignals = [
    "unless ",
    "only if",
    "only where",
    "would have to be",
    "should not be curtailed",
    "depends on",
    "cannot take exception",
  ];
  const ruleSignals = [
    "out of order",
    "not in order",
    "prohibits",
    "must not",
    "may not",
    "is inappropriate",
    "are inappropriate",
    "should not",
  ];

  let authorityFunction: AuthorityFunction = "context";

  if (isPointsOfOrder) {
    authorityFunction = "procedure";
  } else if (exceptionSignals.some((signal) => content.includes(signal))) {
    authorityFunction = "exception";
  } else if (isEffect) {
    authorityFunction = "effect";
  } else if (
    isAcceptance ||
    heading === "form of reply" ||
    heading === "withdrawal" ||
    constraintSignals.some((signal) => content.includes(signal))
  ) {
    authorityFunction = "constraint";
  } else if (heading === "procedure") {
    authorityFunction = "procedure";
  } else if (ruleSignals.some((signal) => content.includes(signal))) {
    authorityFunction = "rule";
  } else if (authorityClass === "governing_rule") {
    authorityFunction = "application";
  }

  return {
    pathText,
    heading,
    isCommitteeOfWhole,
    isCommitteeStage,
    isRulesOfDebate,
    isPersonalReflections,
    isAgainstMembers,
    isAllegationsOfRacism,
    isChairperson,
    isPointsOfOrder,
    isRelevancy,
    isSelectCommitteeChairpersons,
    isClosure,
    isAcceptance,
    isEffect,
    authorityClass,
    authorityFunction,
  };
}

function headingMatches(
  result: ProceduralSearchResult,
  headings?: string[],
): boolean {
  if (!headings || headings.length === 0) return true;
  const heading = (result.heading ?? "").toLowerCase();
  return headings.some((candidate) => heading === candidate.toLowerCase());
}

function pathMatches(
  result: ProceduralSearchResult,
  pathIncludes?: string[],
): boolean {
  if (!pathIncludes || pathIncludes.length === 0) return true;
  const pathText = result.path.join(" > ").toLowerCase();
  return pathIncludes.some((candidate) =>
    pathText.includes(candidate.toLowerCase()),
  );
}

function classMatches(
  result: ProceduralSearchResult,
  classes?: AuthorityClass[],
): boolean {
  if (!classes || classes.length === 0) return true;
  const profile = buildAuthorityProfile(result);
  return classes.includes(profile.authorityClass);
}

function functionMatches(
  result: ProceduralSearchResult,
  functions?: AuthorityFunction[],
): boolean {
  if (!functions || functions.length === 0) return true;
  const profile = buildAuthorityProfile(result);
  return functions.includes(profile.authorityFunction);
}

function corpusMatches(
  result: ProceduralSearchResult,
  preferredCorpora?: Array<"standing_orders" | "speakers_rulings">,
): boolean {
  if (!preferredCorpora || preferredCorpora.length === 0) return true;
  return preferredCorpora.includes(
    result.documentCorpus as "standing_orders" | "speakers_rulings",
  );
}

function requiredTextMatches(
  _result: ProceduralSearchResult,
  _requiredTextIncludes?: string[],
): boolean {
  return true;
}

function matchesSlot(
  result: ProceduralSearchResult,
  slot: AuthoritySlotSpec,
): boolean {
  return (
    headingMatches(result, slot.headings) &&
    pathMatches(result, slot.pathIncludes) &&
    classMatches(result, slot.classes) &&
    functionMatches(result, slot.functions) &&
    corpusMatches(result, slot.preferredCorpora) &&
    requiredTextMatches(result, slot.requiredTextIncludes)
  );
}

function matchesExclusion(
  result: ProceduralSearchResult,
  exclusion: AuthorityExclusionSpec,
): boolean {
  return (
    headingMatches(result, exclusion.headings) &&
    pathMatches(result, exclusion.pathIncludes)
  );
}

function isExcludedByConcepts(
  result: ProceduralSearchResult,
  concepts: ProceduralConcept[],
): boolean {
  return concepts.some((concept) =>
    (concept.exclusions ?? []).some((exclusion) =>
      matchesExclusion(result, exclusion),
    ),
  );
}

function scoreContextualAuthority(input: {
  result: ProceduralSearchResult;
  query: string;
  frame: DerivedFrame;
}): number {
  void input;
  return 0;
}

function dedupeScoredAuthorities(
  results: ScoredAuthority[],
): ScoredAuthority[] {
  const seen = new Set<string>();
  const output: ScoredAuthority[] = [];

  for (const item of results) {
    if (seen.has(item.result.sectionId)) continue;
    seen.add(item.result.sectionId);
    output.push(item);
  }

  return output;
}

const DYNAMIC_DISCOVERY_STOP_QUERIES = new Set([
  "procedure",
  "procedures",
  "rule",
  "rules",
  "house",
  "debate",
  "member",
  "speaker",
  "chair",
]);

const CORPUS_BRIDGE_STOP_HEADINGS = new Set([
  ...DYNAMIC_DISCOVERY_STOP_QUERIES,
  "general",
  "general procedures",
  "maintenance of order",
  "parliament house",
  "questions",
  "motions",
]);

const GENERIC_DISCOVERY_HEADINGS = new Set([
  ...CORPUS_BRIDGE_STOP_HEADINGS,
  "example",
  "examples",
]);

const DISCOVERY_TOKEN_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "be",
  "being",
  "by",
  "chamber",
  "for",
  "from",
  "house",
  "in",
  "into",
  "is",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "with",
]);

function discoveryTokens(text: string): Set<string> {
  const tokens = cleanQuery(text)
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];

  return new Set(
    tokens
      .filter((token) => token.length >= 3)
      .filter((token) => !DISCOVERY_TOKEN_STOP_WORDS.has(token)),
  );
}

function hasMeaningfulHeadingAffinity(query: string, heading: string): boolean {
  if (normalizeConceptTrigger(query) === normalizeHeadingForDiscovery(heading)) {
    return true;
  }

  const queryTokens = discoveryTokens(query);
  const headingTokens = discoveryTokens(heading);

  if (queryTokens.size === 0 || headingTokens.size === 0) return false;

  const sharedTokenCount = [...queryTokens].filter((token) =>
    headingTokens.has(token),
  ).length;

  if (queryTokens.size === 1 && headingTokens.size === 1) {
    return sharedTokenCount === 1;
  }

  return sharedTokenCount >= 2;
}

function normalizedStaticConceptTerms(
  concept: ProceduralConcept,
): Set<string> {
  return new Set(
    [
      ...concept.aliases,
      ...(concept.plannerTriggers ?? []),
      ...concept.preferredQueries,
    ]
      .map(normalizeConceptTrigger)
      .filter(Boolean),
  );
}

function searchDimensionCoveredByStaticConcept(
  search: SearchExecution,
  concepts: ProceduralConcept[],
): boolean {
  const query = normalizeConceptTrigger(search.query);
  if (!query) return false;

  return concepts.some((concept) =>
    normalizedStaticConceptTerms(concept).has(query),
  );
}

function discoveryKey(text: string): string {
  return cleanQuery(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function normalizeHeadingForDiscovery(heading: string): string {
  return normalizeWhitespace(heading).toLowerCase();
}

function strongestEligibleCorpusBreadcrumb(
  search: SearchExecution,
  concepts: ProceduralConcept[],
): ProceduralSearchResult | null {
  return (
    search.results.slice(0, 3).find((result) => {
      const heading = result.heading?.trim();
      if (!heading) return false;

      const normalizedHeading = normalizeHeadingForDiscovery(heading);
      if (GENERIC_DISCOVERY_HEADINGS.has(normalizedHeading)) return false;
      if (normalizedHeading === normalizeConceptTrigger(search.query)) {
        return false;
      }

      const headingSearch: SearchExecution = {
        query: heading,
        corpus: result.documentCorpus,
        provenance: "corpus_bridge",
        results: [],
      };

      return !searchDimensionCoveredByStaticConcept(headingSearch, concepts);
    }) ?? null
  );
}

type HeadingEvidenceGroup = {
  heading: string;
  results: ProceduralSearchResult[];
  exactHeadingCount: number;
  headingPhraseCount: number;
  maxRank: number;
  maxClusterSupportCount: number;
};

function strongestHeadingEvidence(
  results: ProceduralSearchResult[],
): HeadingEvidenceGroup | null {
  const groups = new Map<string, HeadingEvidenceGroup>();

  for (const result of results) {
    const heading = result.heading?.trim();
    if (!heading) continue;
    if (
      !result.matchSignals.exactHeadingMatch &&
      !result.matchSignals.headingPhraseMatch
    ) {
      continue;
    }

    const key = normalizeHeadingForDiscovery(heading);
    const existing = groups.get(key) ?? {
      heading,
      results: [],
      exactHeadingCount: 0,
      headingPhraseCount: 0,
      maxRank: 0,
      maxClusterSupportCount: 0,
    };

    existing.results.push(result);
    if (result.matchSignals.exactHeadingMatch) existing.exactHeadingCount += 1;
    if (result.matchSignals.headingPhraseMatch) existing.headingPhraseCount += 1;
    existing.maxRank = Math.max(existing.maxRank, result.rank);
    existing.maxClusterSupportCount = Math.max(
      existing.maxClusterSupportCount,
      result.clusterSupportCount,
    );
    groups.set(key, existing);
  }

  return [...groups.values()].sort((a, b) => {
    if (b.exactHeadingCount !== a.exactHeadingCount) {
      return b.exactHeadingCount - a.exactHeadingCount;
    }
    if (b.results.length !== a.results.length) {
      return b.results.length - a.results.length;
    }
    return b.maxRank - a.maxRank;
  })[0] ?? null;
}

export function discoverProceduralDimensions(input: {
  searches: SearchExecution[];
  concepts: ProceduralConcept[];
}): DiscoveredProceduralDimension[] {
  const output: DiscoveredProceduralDimension[] = [];

  for (const search of input.searches) {
    const provenance = search.provenance ?? "registry_expansion";
    if (
      provenance !== "planner" &&
      provenance !== "user_term" &&
      provenance !== "corpus_bridge"
    ) {
      continue;
    }

    const query = cleanQuery(search.query);
    const normalizedQuery = query.toLowerCase();
    const bridgeSourceQuery = search.bridgeSourceQuery ?? null;
    const bridgeSourceCitationLabel = search.bridgeSourceCitationLabel ?? null;

    if (searchDimensionCoveredByStaticConcept(search, input.concepts)) {
      output.push({
        conceptId: `static:${discoveryKey(query)}`,
        query,
        provenance,
        status: "covered_by_static",
        validation: "A static registry concept already owns this search dimension.",
        heading: null,
        evidenceCount: 0,
        slotKey: null,
        bridgeSourceQuery,
        bridgeSourceCitationLabel,
      });
      continue;
    }

    if (DYNAMIC_DISCOVERY_STOP_QUERIES.has(normalizedQuery)) {
      output.push({
        conceptId: `rejected:${discoveryKey(query)}`,
        query,
        provenance,
        status: "rejected",
        validation: "The search dimension is too generic to create a runtime procedural concept.",
        heading: null,
        evidenceCount: 0,
        slotKey: null,
        bridgeSourceQuery,
        bridgeSourceCitationLabel,
      });
      continue;
    }

    const evidence = strongestHeadingEvidence(search.results);
    if (!evidence) {
      output.push({
        conceptId: `rejected:${discoveryKey(query)}`,
        query,
        provenance,
        status: "rejected",
        validation: "No heading-level corpus evidence supported promotion.",
        heading: null,
        evidenceCount: 0,
        slotKey: null,
        bridgeSourceQuery,
        bridgeSourceCitationLabel,
      });
      continue;
    }

    const normalizedEvidenceHeading = normalizeHeadingForDiscovery(
      evidence.heading,
    );
    const genericHeading =
      GENERIC_DISCOVERY_HEADINGS.has(normalizedEvidenceHeading);
    const hasHeadingAffinity = hasMeaningfulHeadingAffinity(
      query,
      evidence.heading,
    );

    const promotedByExactHeading =
      !genericHeading &&
      hasHeadingAffinity &&
      evidence.exactHeadingCount >= 1 &&
      (evidence.maxRank >= 120 || evidence.results.length >= 2);
    const promotedByHeadingCluster =
      !genericHeading &&
      hasHeadingAffinity &&
      evidence.headingPhraseCount >= 2 &&
      evidence.maxRank >= 180;

    // A corpus bridge begins with a weak semantic breadcrumb. Searching the
    // breadcrumb heading will necessarily create an exact-heading match, so
    // exactness alone would be circular evidence. Require a coherent
    // multi-authority heading family before a bridge may create a concept.
    const promotedByCorpusBridge =
      !genericHeading &&
      evidence.results.length >= 2 &&
      evidence.maxClusterSupportCount >= 2 &&
      evidence.maxRank >= 180 &&
      (evidence.exactHeadingCount >= 2 || evidence.headingPhraseCount >= 2);

    const promoted =
      provenance === "corpus_bridge"
        ? promotedByCorpusBridge
        : promotedByExactHeading || promotedByHeadingCluster;
    const key = discoveryKey(evidence.heading || query);

    const rejectionReason = genericHeading
      ? `Heading "${evidence.heading}" is structurally generic and cannot create a runtime procedural concept.`
      : provenance !== "corpus_bridge" && !hasHeadingAffinity
        ? `Heading evidence for "${evidence.heading}" lacked enough meaningful lexical affinity to the search dimension "${query}".`
        : provenance === "corpus_bridge"
          ? "The breadcrumb heading did not show enough independent multi-authority corpus support to create a runtime concept."
          : "Heading evidence was present but did not meet the promotion threshold.";

    output.push({
      conceptId: promoted ? `discovered:${key}` : `rejected:${discoveryKey(query)}`,
      query,
      provenance,
      status: promoted ? "promoted" : "rejected",
      validation: promoted
        ? provenance === "corpus_bridge"
          ? `Promoted after corpus-bridge validation: ${evidence.results.length} coherent heading matches with cluster support ${evidence.maxClusterSupportCount}.`
          : evidence.exactHeadingCount > 0
            ? `Promoted from heading-level corpus evidence: ${evidence.exactHeadingCount} exact-heading match(es), ${evidence.results.length} coherent heading match(es).`
            : `Promoted from a coherent heading-phrase cluster of ${evidence.results.length} results with meaningful lexical affinity.`
        : rejectionReason,
      heading: evidence.heading,
      evidenceCount: evidence.results.length,
      slotKey: promoted ? `discovered_${key}` : null,
      bridgeSourceQuery,
      bridgeSourceCitationLabel,
    });
  }

  const promotedByHeading = new Map(
    output
      .filter(
        (dimension) =>
          dimension.status === "promoted" && Boolean(dimension.heading),
      )
      .map((dimension) => [
        normalizeHeadingForDiscovery(dimension.heading ?? ""),
        dimension,
      ]),
  );

  return output.map((dimension) => {
    if (
      dimension.status !== "rejected" ||
      (dimension.provenance !== "planner" &&
        dimension.provenance !== "user_term")
    ) {
      return dimension;
    }

    const sourceSearch = input.searches.find(
      (search) =>
        (search.provenance ?? "registry_expansion") === dimension.provenance &&
        normalizeConceptTrigger(search.query) ===
          normalizeConceptTrigger(dimension.query),
    );
    if (!sourceSearch) return dimension;

    const breadcrumb = strongestEligibleCorpusBreadcrumb(
      sourceSearch,
      input.concepts,
    );
    if (!breadcrumb?.heading) return dimension;

    const promoted = promotedByHeading.get(
      normalizeHeadingForDiscovery(breadcrumb.heading),
    );
    if (!promoted?.heading || !promoted.slotKey) return dimension;

    return {
      ...dimension,
      conceptId: promoted.conceptId,
      status: "bound_to_promoted",
      validation: `Strongest corpus breadcrumb ${breadcrumb.citationLabel} maps to already-promoted heading "${promoted.heading}". Bound to that concept; no additional bridge search is needed.`,
      heading: promoted.heading,
      evidenceCount: 1,
      slotKey: promoted.slotKey,
      bridgeSourceQuery: dimension.query,
      bridgeSourceCitationLabel: breadcrumb.citationLabel,
    };
  });
}

export function buildCorpusBridgeSearchRequests(input: {
  searches: SearchExecution[];
  question: string;
  plannerQueries?: string[];
  maxRequests?: number;
}): CorpusBridgeSearchRequest[] {
  const frame = deriveFrame(input.question, input.plannerQueries ?? []);
  const discoveries = discoverProceduralDimensions({
    searches: input.searches,
    concepts: frame.activeConcepts,
  });
  const discoveryBySearch = new Map(
    discoveries.map((dimension) => [
      `${dimension.provenance}::${normalizeConceptTrigger(dimension.query)}`,
      dimension,
    ]),
  );
  const existingSearchKeys = new Set(
    input.searches.map(
      (search) =>
        `${search.corpus ?? "auto"}::${normalizeConceptTrigger(search.query)}`,
    ),
  );
  const candidates: Array<{
    request: CorpusBridgeSearchRequest;
    sourceRank: number;
    sourcePriority: number;
  }> = [];

  for (const search of input.searches) {
    const provenance = search.provenance ?? "registry_expansion";
    if (provenance !== "planner" && provenance !== "user_term") continue;

    const discovery = discoveryBySearch.get(
      `${provenance}::${normalizeConceptTrigger(search.query)}`,
    );
    if (!discovery || discovery.status !== "rejected") continue;
    if (search.results.length === 0) continue;

    const breadcrumb = strongestEligibleCorpusBreadcrumb(
      search,
      frame.activeConcepts,
    );

    if (!breadcrumb?.heading) continue;

    const corpus =
      breadcrumb.documentCorpus === "standing_orders" ||
      breadcrumb.documentCorpus === "speakers_rulings"
        ? breadcrumb.documentCorpus
        : search.corpus === "standing_orders" ||
            search.corpus === "speakers_rulings"
          ? search.corpus
          : null;

    const headingSearchKey = `${corpus ?? "auto"}::${normalizeConceptTrigger(
      breadcrumb.heading,
    )}`;
    if (existingSearchKeys.has(headingSearchKey)) {
      continue;
    }

    candidates.push({
      request: {
        query: cleanQuery(breadcrumb.heading),
        corpus,
        sourceQuery: cleanQuery(search.query),
        sourceProvenance: provenance,
        sourceCitationLabel: breadcrumb.citationLabel,
      },
      sourceRank: breadcrumb.rank,
      sourcePriority: provenance === "user_term" ? 1 : 0,
    });
  }

  candidates.sort((a, b) => {
    if (b.sourcePriority !== a.sourcePriority) {
      return b.sourcePriority - a.sourcePriority;
    }
    return b.sourceRank - a.sourceRank;
  });

  const maxRequests = Math.max(1, Math.min(input.maxRequests ?? 2, 2));
  const seen = new Set<string>();
  const output: CorpusBridgeSearchRequest[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.request.corpus ?? "auto"}::${normalizeConceptTrigger(candidate.request.query)}`;
    if (seen.has(key)) continue;

    seen.add(key);
    output.push(candidate.request);
    if (output.length >= maxRequests) break;
  }

  return output;
}

function buildDiscoveredSlots(
  discoveries: DiscoveredProceduralDimension[],
  searches: SearchExecution[],
  requirement: "required" | "optional",
): AuthoritySlotSpec[] {
  const seen = new Set<string>();
  const slots: AuthoritySlotSpec[] = [];

  for (const discovery of discoveries) {
    if (
      discovery.status !== "promoted" ||
      !discovery.heading ||
      !discovery.slotKey ||
      seen.has(discovery.slotKey)
    ) {
      continue;
    }

    seen.add(discovery.slotKey);

    const sourceSearch = searches.find(
      (search) =>
        cleanQuery(search.query).toLowerCase() ===
          cleanQuery(discovery.query).toLowerCase() &&
        (search.provenance ?? "registry_expansion") === discovery.provenance,
    );
    const corpus =
      sourceSearch?.corpus === "standing_orders" ||
      sourceSearch?.corpus === "speakers_rulings"
        ? sourceSearch.corpus
        : null;

    const discoveryHeading = normalizeHeadingForDiscovery(discovery.heading);
    const linkedUserTerms = searches
      .filter((search) => search.provenance === "user_term")
      .filter((search) =>
        search.results.some(
          (result) =>
            result.heading &&
            normalizeHeadingForDiscovery(result.heading) === discoveryHeading &&
            result.matchSignals.bodyPhraseMatch,
        ),
      )
      .map((search) => cleanQuery(search.query))
      .filter(Boolean);

    slots.push({
      key: discovery.slotKey,
      requirement,
      headings: [discovery.heading],
      preferredCorpora: corpus ? [corpus] : undefined,
      preferredTextIncludes:
        linkedUserTerms.length > 0 ? linkedUserTerms : undefined,
      maxMatches: 1,
    });
  }

  return slots;
}

function buildBlueprintSlots(
  concepts: ProceduralConcept[],
  discoveredSlots: AuthoritySlotSpec[] = [],
): AuthoritySlotSpec[] {
  const seen = new Set<string>();
  const superseded = new Set(
    concepts.flatMap((concept) => concept.supersedesSlots ?? []),
  );
  const slots: AuthoritySlotSpec[] = [];

  for (const concept of concepts) {
    for (const slot of concept.slots) {
      if (superseded.has(slot.key) || seen.has(slot.key)) continue;
      seen.add(slot.key);
      slots.push(slot);
    }
  }

  for (const slot of discoveredSlots) {
    if (seen.has(slot.key)) continue;
    seen.add(slot.key);
    slots.push(slot);
  }

  return slots;
}

export function buildMissingSlotRecoveryRequests(input: {
  question: string;
  plannerQueries?: string[];
  missingRequiredSlots: string[];
  requestedCorpus?: "standing_orders" | "speakers_rulings" | null;
  maxRequests?: number;
}): RecoverySearchRequest[] {
  const frame = deriveFrame(input.question, input.plannerQueries ?? []);
  const slots = buildBlueprintSlots(frame.activeConcepts);
  const missing = new Set(input.missingRequiredSlots);
  const seen = new Set<string>();
  const output: RecoverySearchRequest[] = [];
  const maxRequests = Math.max(1, Math.min(input.maxRequests ?? 4, 8));

  for (const slot of slots) {
    if (!missing.has(slot.key)) continue;

    const queries =
      slot.recoveryQueries?.length
        ? slot.recoveryQueries
        : slot.requiredTextIncludes ?? [];

    const corpora: Array<"standing_orders" | "speakers_rulings" | null> =
      input.requestedCorpus
        ? [input.requestedCorpus]
        : slot.recoveryCorpora?.length
          ? slot.recoveryCorpora
          : slot.preferredCorpora?.length
            ? slot.preferredCorpora
            : [null];

    for (const query of queries) {
      for (const corpus of corpora) {
        const normalizedQuery = cleanQuery(query);
        if (!normalizedQuery) continue;

        const key = `${slot.key}::${corpus ?? "auto"}::${normalizedQuery.toLowerCase()}`;
        if (seen.has(key)) continue;

        seen.add(key);
        output.push({
          slotKey: slot.key,
          query: normalizedQuery,
          corpus,
        });

        if (output.length >= maxRequests) {
          return output;
        }
      }
    }
  }

  return output;
}

function humanizeSlotKey(slotKey: string): string {
  return slotKey.replace(/_/g, " ");
}

export function describeMissingAuthoritySlots(input: {
  question: string;
  plannerQueries?: string[];
  missingRequiredSlots: string[];
}): MissingEvidenceGap[] {
  const frame = deriveFrame(input.question, input.plannerQueries ?? []);
  const slots = buildBlueprintSlots(frame.activeConcepts);
  const slotByKey = new Map(slots.map((slot) => [slot.key, slot]));

  return input.missingRequiredSlots.map((slotKey) => {
    const slot = slotByKey.get(slotKey);
    return {
      slotKey,
      description:
        slot?.evidenceGapDescription ??
        `the required evidence for ${humanizeSlotKey(slotKey)}`,
    };
  });
}

function isRequiredSlot(slot: AuthoritySlotSpec): boolean {
  return slot.requirement === "required";
}

function scorePreferredText(
  _result: ProceduralSearchResult,
  _slot: AuthoritySlotSpec,
): number {
  return 0;
}

function scoreContextualBridgeText(
  _result: ProceduralSearchResult,
  _slot: AuthoritySlotSpec,
  _activeConceptIds: Set<string>,
): number {
  return 0;
}

function scoreDiscoveryBreadcrumb(
  result: ProceduralSearchResult,
  discoveries: DiscoveredProceduralDimension[],
): number {
  const resultHeading = result.heading
    ? normalizeHeadingForDiscovery(result.heading)
    : null;

  return discoveries.reduce((score, discovery) => {
    const isValidatedBridgeBreadcrumb =
      discovery.status === "promoted" &&
      discovery.provenance === "corpus_bridge";
    const isBoundBreadcrumb =
      discovery.status === "bound_to_promoted" &&
      (discovery.provenance === "planner" ||
        discovery.provenance === "user_term");

    if (
      (!isValidatedBridgeBreadcrumb && !isBoundBreadcrumb) ||
      !discovery.heading ||
      !discovery.bridgeSourceCitationLabel ||
      discovery.bridgeSourceCitationLabel !== result.citationLabel ||
      !resultHeading ||
      resultHeading !== normalizeHeadingForDiscovery(discovery.heading)
    ) {
      return score;
    }

    // Once a heading family is independently validated, prefer the strongest
    // semantic breadcrumb that led the user into that family. Use a fixed
    // affinity rather than stacking duplicate bridge/binding evidence.
    return Math.max(score, 260);
  }, 0);
}

function scoreSlotMatches(
  result: ProceduralSearchResult,
  slots: AuthoritySlotSpec[],
  activeConceptIds: Set<string>,
): {
  matchedSlotKeys: string[];
  slotBoost: number;
  preferredTextBoost: number;
  bridgeBoost: number;
} {
  const matchedSlots = slots.filter((slot) => matchesSlot(result, slot));
  const matchedSlotKeys = matchedSlots.map((slot) => slot.key);

  const slotBoost = matchedSlots.length * 180;
  const preferredTextBoost = matchedSlots.reduce(
    (score, slot) => score + scorePreferredText(result, slot),
    0,
  );
  const bridgeBoost = matchedSlots.reduce(
    (score, slot) =>
      score + scoreContextualBridgeText(result, slot, activeConceptIds),
    0,
  );

  return {
    matchedSlotKeys,
    slotBoost,
    preferredTextBoost,
    bridgeBoost,
  };
}

function profileFamilyKey(item: ScoredAuthority): string {
  const heading = (item.result.heading ?? "none").toLowerCase();
  const pathTail = item.result.path.slice(-2).join(" > ").toLowerCase();
  return `${heading}::${pathTail}`;
}

function slotMaxForItem(
  item: ScoredAuthority,
  slots: AuthoritySlotSpec[],
): number {
  const matched = slots.find((slot) => item.matchedSlotKeys.includes(slot.key));
  return matched?.maxMatches ?? 2;
}

function passesMinimumThreshold(item: ScoredAuthority): boolean {
  if (item.slotBoost > 0) return true;
  if (item.routeBoost > 0) return true;
  if (item.adjustedRank >= 120) return true;
  if (item.result.matchSignals.exactSectionKeyMatch) return true;
  if (item.result.matchSignals.exactCitationMatch) return true;
  if (item.result.matchSignals.exactHeadingMatch) return true;
  if (item.result.matchSignals.headingPhraseMatch) return true;
  if (item.result.matchSignals.pathPhraseMatch) return true;
  return false;
}

export function selectFinalAuthorities(input: {
  searches: SearchExecution[];
  question: string;
  plannerQueries?: string[];
  maxAuthorities?: number;
}): {
  finalAuthorities: ProceduralSearchResult[];
  scoredAuthorities: ScoredAuthority[];
  activeConceptIds: string[];
  blueprintSlots: string[];
  requiredSlots: string[];
  optionalSlots: string[];
  satisfiedSlots: string[];
  missingRequiredSlots: string[];
  blueprintSatisfied: boolean;
  selectedSlotMatches: SlotMatch[];
  discoveredDimensions: DiscoveredProceduralDimension[];
} {
  const frame = deriveFrame(input.question, input.plannerQueries ?? []);
  const discoveredDimensions = discoverProceduralDimensions({
    searches: input.searches,
    concepts: frame.activeConcepts,
  });
  const staticSlots = buildBlueprintSlots(frame.activeConcepts);
  // Dynamic discovery is authoritative only for genuinely discovery-only topics.
  // When a known static concept already supplies a blueprint, discovered dimensions
  // may supplement it but must not become required and displace the static slots.
  const discoveredRequirement =
    staticSlots.length > 0 ? "optional" : "required";
  const discoveredSlots = buildDiscoveredSlots(
    discoveredDimensions,
    input.searches,
    discoveredRequirement,
  );
  const slots = buildBlueprintSlots(frame.activeConcepts, discoveredSlots);
  const promotedConceptIds = discoveredDimensions
    .filter((dimension) => dimension.status === "promoted")
    .map((dimension) => dimension.conceptId);
  const activeConceptIds = new Set([
    ...frame.activeConcepts.map((concept) => concept.id),
    ...promotedConceptIds,
  ]);

  const flattened: ScoredAuthority[] = input.searches.flatMap(
    (search, queryIndex) =>
      search.results.map((result) => {
        const routeBoost = scoreContextualAuthority({
          result,
          query: search.query,
          frame,
        });

        const {
          matchedSlotKeys,
          slotBoost,
          preferredTextBoost,
          bridgeBoost,
        } = scoreSlotMatches(result, slots, activeConceptIds);
        const discoveryBoost = scoreDiscoveryBreadcrumb(
          result,
          discoveredDimensions,
        );

        return {
          result,
          query: search.query,
          queryIndex,
          routeBoost,
          slotBoost,
          preferredTextBoost,
          bridgeBoost,
          discoveryBoost,
          adjustedRank:
            result.rank +
            routeBoost +
            slotBoost +
            preferredTextBoost +
            bridgeBoost +
            discoveryBoost,
          matchedSlotKeys,
        };
      }),
  );

  const sorted = [...flattened].sort((a, b) => {
    if (b.adjustedRank !== a.adjustedRank)
      return b.adjustedRank - a.adjustedRank;
    if (b.discoveryBoost !== a.discoveryBoost)
      return b.discoveryBoost - a.discoveryBoost;
    if (b.bridgeBoost !== a.bridgeBoost) return b.bridgeBoost - a.bridgeBoost;
    if (b.preferredTextBoost !== a.preferredTextBoost)
      return b.preferredTextBoost - a.preferredTextBoost;
    if (b.slotBoost !== a.slotBoost) return b.slotBoost - a.slotBoost;
    if (b.routeBoost !== a.routeBoost) return b.routeBoost - a.routeBoost;
    if (b.result.rank !== a.result.rank) return b.result.rank - a.result.rank;
    return a.result.citationLabel.localeCompare(b.result.citationLabel);
  });

  const deduped = dedupeScoredAuthorities(sorted);
  const selected: ScoredAuthority[] = [];
  const seen = new Set<string>();
  const familyCounts = new Map<string, number>();
  const satisfiedSlotKeys = new Set<string>();
  const selectedSlotMatches: SlotMatch[] = [];

  const requiredSlots = slots
    .filter(isRequiredSlot)
    .map((slot) => slot.key);
  const optionalSlots = slots
    .filter((slot) => !isRequiredSlot(slot))
    .map((slot) => slot.key);

  const staticPackBudget = frame.activeConcepts.reduce((total, concept) => {
    const contributesStaticSlot = concept.slots.some((conceptSlot) =>
      staticSlots.some((staticSlot) => staticSlot.key === conceptSlot.key),
    );

    if (!contributesStaticSlot) return total;

    return total + (concept.defaultPackContribution ?? concept.slots.length);
  }, 0);

  const defaultMaxAuthorities =
    staticSlots.length > 0
      ? Math.max(1, Math.min(staticPackBudget || staticSlots.length, 8))
      : slots.length > 0
        ? Math.max(1, Math.min(slots.length, 8))
        : 4;

  const computedMaxAuthorities = Math.min(
    10,
    Math.max(1, input.maxAuthorities ?? defaultMaxAuthorities),
  );

  function canAdd(item: ScoredAuthority): boolean {
    if (seen.has(item.result.sectionId)) return false;
    if (isExcludedByConcepts(item.result, frame.activeConcepts)) return false;
    if (!passesMinimumThreshold(item)) return false;

    const key = profileFamilyKey(item);
    const count = familyCounts.get(key) ?? 0;
    return count < slotMaxForItem(item, slots);
  }

  function add(item: ScoredAuthority) {
    selected.push(item);
    seen.add(item.result.sectionId);

    const key = profileFamilyKey(item);
    familyCounts.set(key, (familyCounts.get(key) ?? 0) + 1);

    for (const slotKey of item.matchedSlotKeys) {
      if (satisfiedSlotKeys.has(slotKey)) continue;

      satisfiedSlotKeys.add(slotKey);
      selectedSlotMatches.push({
        slotKey,
        citationLabel: item.result.citationLabel,
        heading: item.result.heading,
      });
    }
  }

  const orderedSlots = [...slots].sort((a, b) => {
    const aRequired = isRequiredSlot(a) ? 1 : 0;
    const bRequired = isRequiredSlot(b) ? 1 : 0;
    return bRequired - aRequired;
  });

  for (const slot of orderedSlots) {
    if (selected.length >= computedMaxAuthorities) break;
    if (satisfiedSlotKeys.has(slot.key)) continue;

    const candidate = deduped.find(
      (item) => item.matchedSlotKeys.includes(slot.key) && canAdd(item),
    );

    if (candidate) add(candidate);
  }

  if (slots.length === 0) {
    for (const item of deduped) {
      if (selected.length >= computedMaxAuthorities) break;
      if (!canAdd(item)) continue;
      add(item);
    }
  }

  const satisfiedSlots = slots
    .map((slot) => slot.key)
    .filter((slotKey) => satisfiedSlotKeys.has(slotKey));

  const missingRequiredSlots = requiredSlots.filter(
    (slotKey) => !satisfiedSlotKeys.has(slotKey),
  );

  return {
    finalAuthorities: selected.map((item) => ({
      ...item.result,
      rank: item.adjustedRank,
    })),
    scoredAuthorities: selected,
    activeConceptIds: [...activeConceptIds],
    blueprintSlots: slots.map((slot) => slot.key),
    requiredSlots,
    optionalSlots,
    satisfiedSlots,
    missingRequiredSlots,
    blueprintSatisfied: missingRequiredSlots.length === 0,
    selectedSlotMatches,
    discoveredDimensions,
  };
}


export async function selectV517ProductionAuthorities(input: {
  searches: SearchExecution[];
  question: string;
  searchProceduralAuthorities: V517SearchFunction;
  maxAuthorities?: number;
  plannerRelations?: string[];
  situation?: {
    kind?: "incident" | "procedure";
    actor?: string;
    setting?: string;
    action?: string;
    decisionQuestion?: string;
    materialFacts?: string[];
    subQuestions?: string[];
  };
}): Promise<V517SelectionResult> {
  return selectV517AuthorityPack({
    question: input.question,
    searches: input.searches,
    searchProceduralAuthorities: input.searchProceduralAuthorities,
    maxAuthorities: input.maxAuthorities,
    plannerRelations: input.plannerRelations,
    situation: input.situation,
  });
}

function normalizeCandidateCitationLabel(citation: string): string {
  return normalizeWhitespace(citation).replace(
    /^standing order\s+/i,
    "SO ",
  );
}

function citationParentLabel(
  citation: string,
  allowedLabels: string[],
): string | null {
  const normalized = normalizeCandidateCitationLabel(citation);
  const exact = allowedLabels.find(
    (label) => label.toLowerCase() === normalized.toLowerCase(),
  );
  if (exact) return exact;

  for (const label of allowedLabels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const childPattern = new RegExp(
      `^${escaped}(?:\\([^()]+\\))+$`,
      "i",
    );
    if (childPattern.test(normalized)) {
      return label;
    }
  }

  return null;
}

export function normalizeAnswerCitationLabels(input: {
  answerText: string;
  authorities: Array<{ citationLabel: string }>;
}): string {
  const allowedLabels = input.authorities.map(
    (authority) => authority.citationLabel,
  );

  return input.answerText.replace(
    /\[([^\]]+)\]/g,
    (match, inner: string) => {
      const parts = inner
        .split(/[;,]/)
        .map((part) => part.trim())
        .filter(Boolean);

      if (parts.length === 0) return match;

      const rewritten = parts.map((part) => {
        const parent = citationParentLabel(part, allowedLabels);
        return `[${parent ?? part}]`;
      });

      return [...new Set(rewritten)].join(" ");
    },
  );
}

export function normalizeAnswerFormatting(text: string): string {
  const normalized = text
    .replace(/^\*\s+/gm, "- ")
    .replace(/^\*\*\s+/gm, "- ")
    .replace(/^\*\s{2,}/gm, "- ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  const headingMap: Array<[RegExp, string]> = [
    [/^Bottom line\s*:?$/im, "Bottom line:"],
    [/^What this means\s*:?$/im, "What this means:"],
    [/^Your options\s*:?$/im, "Your options:"],
    [/^Risks(?: or)? constraints\s*:?$/im, "Risks or constraints:"],
    [/^Best authorities to inspect(?: or cite)?\s*:?$/im, "Best authorities to inspect or cite:"],
  ];

  return headingMap.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    normalized,
  );
}

export function removeEmptyAnswerSections(answerText: string): string {
  const lines = normalizeAnswerFormatting(answerText).split("\n");
  const output: string[] = [];

  for (let index = 0; index < lines.length; ) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!isStructuralHeading(trimmed)) {
      output.push(line);
      index += 1;
      continue;
    }

    let nextHeadingIndex = index + 1;
    while (
      nextHeadingIndex < lines.length &&
      !isStructuralHeading(lines[nextHeadingIndex].trim())
    ) {
      nextHeadingIndex += 1;
    }

    const sectionBody = lines
      .slice(index + 1, nextHeadingIndex)
      .filter((candidate) => candidate.trim().length > 0);

    if (sectionBody.length > 0) {
      output.push(line, ...lines.slice(index + 1, nextHeadingIndex));
    }

    index = nextHeadingIndex;
  }

  return output
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function answerSectionHasContent(
  answerText: string,
  heading: string,
): boolean {
  const normalizedHeading = heading.trim();
  const lines = normalizeAnswerFormatting(answerText).split("\n");
  const headingIndex = lines.findIndex(
    (line) => line.trim() === normalizedHeading,
  );

  if (headingIndex < 0) return false;

  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (isStructuralHeading(trimmed)) break;
    if (trimmed) return true;
  }

  return false;
}

function extractInlineCitations(answerText: string): string[] {
  const matches = answerText.match(/\[[^\]]+\]/g) ?? [];
  return matches.map((match) => match.slice(1, -1).trim()).filter(Boolean);
}

function looksLikeEmbeddedAuthorityReference(citation: string): boolean {
  const lower = citation.toLowerCase();

  return (
    lower.includes("mentioned in") ||
    lower.includes("referred to in") ||
    lower.includes("cited in")
  );
}

function isCitationAllowed(cited: string, allowedLabels: Set<string>): boolean {
  if (allowedLabels.has(cited)) return true;

  for (const label of allowedLabels) {
    if (
      cited === label ||
      cited.startsWith(`${label}(`) ||
      cited.startsWith(`${label} `) ||
      cited.startsWith(`${label},`) ||
      cited.startsWith(`${label};`) ||
      cited.startsWith(`${label}:`)
    ) {
      return true;
    }
  }

  return false;
}

function citationParts(cited: string): string[] {
  const parts = cited.split(/\s*(?:,|;|\band\b)\s*/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [cited];
}

function citationCandidates(prefix: string, part: string): string[] {
  const direct = `${prefix}${part}`.replace(/\s+/g, " ").trim();
  const forms = [direct];
  if (/^(?:standing orders?|s\.?\s*o\.?s?)\s+$/i.test(prefix)) forms.push(`SO ${part}`);
  return forms;
}

/** A bare "(2)" or "(a)" continues the previous label. A bare "2" continues its prefix. */
function citationIsGrounded(cited: string, allowedLabels: Set<string>, allowedForms: Set<string>): boolean {
  const parts = citationParts(cited);
  let prefix = "";
  let parent = "";
  let sawLabel = false;
  for (const part of parts) {
    if (/^\([0-9a-z]+\)$/i.test(part)) {
      const continued = parent ? citationCandidates("", `${parent}${part}`) : [];
      const ok = continued.some((item) => isCitationAllowed(item, allowedLabels))
        || (parent !== "" && isCitationAllowed(parent, allowedLabels));
      if (!ok) return false;
      continue;
    }
    // A quantity is not a provision only when it continues a label already admitted.
    if (parent !== "" && QUANTITY_CONTINUATION.test(part)) continue;
    if (/^\d+[a-z]*$/i.test(part)) {
      const resolved = citationCandidates(prefix, part).find((item) => isCitationAllowed(item, allowedLabels));
      if (!resolved) return false;
      parent = resolved.replace(/\(.*/, "");
      sawLabel = true;
      continue;
    }
    if (!isCitationAllowed(part, allowedLabels)) return false;
    const head = part.match(/^(.*?\d+[a-z]*)/i);
    parent = (head?.[1] ?? part).replace(/\(.*/, "");
    const lead = part.match(/^(.*?)(?=\d)/);
    prefix = lead?.[1] ?? prefix;
    sawLabel = true;
  }
  if (!sawLabel) return false;
  return mentionSpans(cited, allowedForms).every((span) => span.admitted && !span.suffix);
}

function stripBracketedCitations(text: string): string {
  return text.replace(/\[[^\]]+\]/g, " ");
}

function normalizeAuthorityMention(text: string): string {
  return text
    .replace(/^standing order\s+/i, "SO ")
    .replace(/^(appendix\s+[a-f]\s+)cl(?:ause)?\.?\s+/i, "$1cl ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Any Unicode space, newline, thin space, U+202F, or zero-width mark that can sit inside a name.
const WS_CLASS = String.raw`\s\u00a0\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u2060\u3000\ufeff`;
const WS = `[${WS_CLASS}]*`;
const WS1 = `[${WS_CLASS}]+`;
// All or nothing: a short number cannot stop before another digit or a slash, and a longer number is taken whole.
const SO_NUM = String.raw`(?:\d{7,}(?:/\d{1,6})?(?!\d)|\d{1,6}(?![\d/]))[a-z]{0,4}(?:${WS}\(\d{1,4}[a-z]{0,2}\))?`;
const SO_SEP = String.raw`(?:,${WS}(?:and|or)?${WS}|${WS}(?:and|or|through|to|&)${WS}|${WS}[-–—]${WS})`;
// Units, times, and people counts are followers. Procedural nouns are followers only after "or more/fewer/less".
// A word followed by an apostrophe is not a follower: "Members' bills" still names 99.
const UNIT = String.raw`(?:per${WS1}cent|calendar${WS1}days?|working${WS1}days?|sitting${WS1}days?|members?|mps?|people|persons?|speakers?|parties|party|votes?|times?|percent|days?|hours?|hrs?|minutes?|mins?|seconds?|secs|weeks?|months?|years?|noon|am|pm|o'clock)`;
const PROCEDURAL = String.raw`(?:questions?|bills?|motions?|amendments?|readings?)`;
const QUANTITY = String.raw`(?:or${WS1}(?:more|fewer|less)${WS1}(?:${UNIT}|${PROCEDURAL})|${UNIT})(?!['’])`;
const JOINED = String.raw`${SO_SEP}${SO_NUM}(?!${WS1}(?:${QUANTITY}\b|a\.m\.|p\.m\.)|${WS}%)`;
const QUANTITY_CONTINUATION = new RegExp(String.raw`^\d{1,6}[a-z]{0,4}(?:${WS}\(\d{1,4}[a-z]{0,2}\))?${WS1}(?:${QUANTITY}\b|a\.m\.|p\.m\.|%)$`, "i");
const LIST_SPAN = `${SO_NUM}(?:${JOINED})*`;
const PLURAL_INTRO = String.raw`(?:standing${WS1}orders\b|s\.?${WS}o\.?${WS}s\b)`;
const SINGULAR_INTRO = String.raw`(?:standing(?:${WS}-${WS}|${WS1})order\b|s\.?${WS}o\.?(?!\.?${WS}s\b))(?:${WS}no\.?)?`;
// N/M never starts in the middle of a longer number. A fraction after an SO name takes the name with it.
// (?<!\d) does not change a match the all-or-nothing number already takes whole. It stays so a
// shorter alternative cannot resume on the second digit of "12/9".
const RULING_NUM = String.raw`(?<!\d)\d{1,6}\/\d{1,6}(?!\d)`;
const PROVISION_MENTION = String.raw`\b(?:${PLURAL_INTRO}|${SINGULAR_INTRO})${WS}${RULING_NUM}|\b${PLURAL_INTRO}${WS}${LIST_SPAN}|\b${SINGULAR_INTRO}${WS}${SO_NUM}(?:${JOINED})*|\bappendix${WS1}[a-f]${WS1}(?:cl(?:ause)?\.?${WS}\d{1,6}[a-z]{0,4}|(?:table|part)${WS1}\d{1,6}${WS1}row${WS1}\d{1,6}|note)\b|\bspeakers?'?${WS1}rulings?${WS}${RULING_NUM}|\bs\.?${WS}r\.?${WS}${RULING_NUM}|\b${RULING_NUM}\b`;

let provisionPattern: RegExp | undefined;
function answerMentionPattern(): RegExp {
  provisionPattern ??= new RegExp(PROVISION_MENTION, "gi");
  provisionPattern.lastIndex = 0;
  return provisionPattern;
}

function allowedProvisionForms(label: string): string[] {
  const flat = label.replace(new RegExp(`[${WS_CLASS}]+`, "g"), " ").trim();
  const forms = new Set<string>([normalizeAuthorityMention(flat), flat.toLowerCase()]);
  const ruling = flat.match(/^(?:s\.?\s*r\.?|speakers?'?\s+rulings?)\s*(\d+\/\d+)$/i);
  if (ruling) {
    forms.add(ruling[1]);
    forms.add(`sr ${ruling[1]}`);
  }
  const bare = flat.match(/^(\d+\/\d+)$/);
  if (bare) forms.add(bare[1]);
  const standing = flat.match(/^(?:standing\s+orders?|s\.?\s*o\.?|so)\s*(\d+[a-z]*)$/i);
  if (standing) forms.add(`so ${standing[1].toLowerCase()}`);
  return [...forms];
}

/** Whole tokens. A ruling N/M stays N/M and never collapses to N. A huge range fails closed. */
function standingTokens(mention: string): string[] | null {
  const body = mention.replace(new RegExp(`^(?:${PLURAL_INTRO}|${SINGULAR_INTRO})${WS}`, "i"), "");
  const number = new RegExp(SO_NUM, "gi");
  const found = [...body.matchAll(number)];
  if (found.length === 0) return null;
  const tokens: string[] = [];
  for (let index = 0; index < found.length; index += 1) {
    const token = found[index][0].replace(new RegExp(`[${WS_CLASS}]+`, "g"), "").toLowerCase();
    if (index > 0) {
      const between = body.slice((found[index - 1].index ?? 0) + found[index - 1][0].length, found[index].index);
      if (/(?:to|through|[-–—])/i.test(between)) {
        const start = Number(found[index - 1][0]);
        const end = Number(found[index][0]);
        if (!Number.isInteger(start) || !Number.isInteger(end) || end < start || end - start > 100) return null;
        tokens.pop();
        for (let value = start; value <= end; value += 1) tokens.push(String(value));
        continue;
      }
    }
    tokens.push(token);
  }
  return tokens;
}

function tokenAdmitted(token: string, allowed: Set<string>): boolean {
  const parent = token.replace(/\(\d+[a-z]*\)$/i, "");
  return [token, parent].some((item) => allowed.has(item) || allowed.has(`so ${item}`) || allowed.has(`sr ${item}`));
}

function mentionIsAdmitted(mention: string, allowed: Set<string>): boolean {
  const flat = mention.replace(new RegExp(`[${WS_CLASS}]+`, "g"), " ").trim();
  const ruling = flat.match(/(?<!\d)\d{1,6}\/\d{1,6}(?!\d)/);
  // A long standing-order spelling of a fraction is never that order. Only the short
  // "SO N/M" and "S.O. N/M" spellings can be an admitted ruling.
  if (ruling && /^(?:standing orders?|s\.?\s*o\.?s)\b/i.test(flat)) return false;
  if (ruling && /^(?:s\.?\s*o\.?|so)\b/i.test(flat)) {
    const whole = ruling[0];
    return allowed.has(whole) || allowed.has(`sr ${whole}`) || allowed.has(`so ${whole}`);
  }
  if (ruling && /rulings?|s\.?\s*r\.?|^\d+\/\d+$/i.test(flat)) {
    const whole = ruling[0];
    return allowed.has(whole) || allowed.has(`sr ${whole}`);
  }
  if (/^appendix\b/i.test(mention.trim())) return allowed.has(normalizeAuthorityMention(mention));
  const tokens = standingTokens(mention);
  if (!tokens || tokens.length === 0) return false;
  return tokens.every((token) => tokenAdmitted(token, allowed));
}

function maskBrackets(text: string): string {
  return text.replace(/\[[^\]]*\]/g, (span) => "\u0000".repeat(span.length));
}

type MentionSpan = { start: number; end: number; mention: string; admitted: boolean; suffix: boolean };

/** The check and the rewrite read these spans, so they cannot disagree. */
function mentionSpans(text: string, allowed: Set<string>): MentionSpan[] {
  const masked = maskBrackets(text);
  const suffix = new RegExp(`^${WS}\\(referred to in\\b[^)]*;${WS}not retrieved\\)`, "i");
  const spans: MentionSpan[] = [];
  let coveredUntil = 0;
  for (const match of masked.matchAll(answerMentionPattern())) {
    const start = match.index ?? 0;
    if (start < coveredUntil) continue;
    const mention = match[0];
    const admitted = mentionIsAdmitted(mention, allowed);
    let end = start + mention.length;
    const trailed = text.slice(end).match(suffix);
    if (trailed) end += trailed[0].length;
    spans.push({
      start,
      end,
      mention,
      admitted,
      suffix: Boolean(trailed),
    });
    coveredUntil = end;
  }
  return spans;
}

function allowedSet(authorities: Array<{ citationLabel: string }>): Set<string> {
  return new Set(authorities.flatMap((authority) => allowedProvisionForms(authority.citationLabel)));
}

export function validateAnswerAuthorityMentions(input: {
  answerText: string;
  authorities: Array<{ citationLabel: string }>;
}): { ok: true } | { ok: false; invalidAuthorityMentions: string[] } {
  const allowed = allowedSet(input.authorities);
  const invalid = mentionSpans(input.answerText, allowed)
    .filter((span) => !span.admitted || span.suffix)
    .map((span) => span.mention.replace(new RegExp(`[${WS_CLASS}]+`, "g"), " ").trim());
  if (invalid.length > 0) return { ok: false, invalidAuthorityMentions: [...new Set(invalid)] };
  return { ok: true };
}

export function rewriteForbiddenAuthorityMentions(input: {
  answerText: string;
  authorities: Array<{ citationLabel: string }>;
}): {
  rewrittenText: string;
  removedMentions: string[];
} {
  const allowed = allowedSet(input.authorities);
  const spans = mentionSpans(input.answerText, allowed).filter((span) => !span.admitted || span.suffix);
  if (spans.length === 0) return { rewrittenText: input.answerText, removedMentions: [] };
  const removed: string[] = [];
  let cursor = 0;
  let rewritten = "";
  for (const span of spans) {
    rewritten += input.answerText.slice(cursor, span.start);
    rewritten += span.admitted ? span.mention : "a provision that was not retrieved";
    removed.push(span.mention.replace(new RegExp(`[${WS_CLASS}]+`, "g"), " ").trim());
    cursor = span.end;
  }
  rewritten += input.answerText.slice(cursor);
  return { rewrittenText: rewritten, removedMentions: [...new Set(removed)] };
}

export function validateAnswerCitations(input: {
  answerText: string;
  authorities: Array<{ citationLabel: string }>;
}): { ok: true } | { ok: false; invalidCitations: string[] } {
  const cited = extractInlineCitations(input.answerText);
  if (cited.length === 0) {
    return { ok: true };
  }

  const allowedLabels = new Set(
    input.authorities.map((authority) => authority.citationLabel),
  );
  const allowedForms = allowedSet(input.authorities);

  const invalidCitations = [
    ...new Set(
      cited.filter(
        (citation) =>
          !citationIsGrounded(citation, allowedLabels, allowedForms) ||
          looksLikeEmbeddedAuthorityReference(citation),
      ),
    ),
  ];

  if (invalidCitations.length > 0) {
    return {
      ok: false,
      invalidCitations,
    };
  }

  return { ok: true };
}

function isStructuralHeading(line: string): boolean {
  return [
    "Bottom line:",
    "What this means:",
    "Your options:",
    "Risks or constraints:",
    "Best authorities to inspect or cite:",
  ].includes(line.trim());
}

function isSubstantiveSection(section: string | null): boolean {
  return (
    section === "Bottom line:" ||
    section === "What this means:" ||
    section === "Your options:" ||
    section === "Risks or constraints:"
  );
}

function lineHasAllowedCitation(
  line: string,
  allowedLabels: Set<string>,
  allowedForms: Set<string>,
): boolean {
  const citations = extractInlineCitations(line);
  if (citations.length === 0) return false;
  return citations.every((citation) => citationIsGrounded(citation, allowedLabels, allowedForms));
}

function isLikelyBestAuthorityLine(line: string): boolean {
  return /^\-\s*\[[^\]]+\]/.test(line.trim()) || /^\-\s*\S+/.test(line.trim());
}

export type ClaimRemovalCode =
  | "no_citation"
  | "citation_not_admitted"
  | "unsupported_by_passage"
  | "omitted_source_qualification";

function stripModelCrossReferenceSuffixes(line: string): string {
  return line.replace(/\(\s*referred to in\b[^)]*;\s*not retrieved\s*\)/gi, " ");
}

/** Full "Standing Order N" or uppercase "SO N". Never the word "so", and never a bare fraction. */
function admittedLabelsNamedIn(line: string, allowedLabels: Set<string>): string[] {
  const allowed = allowedSet([...allowedLabels].map((citationLabel) => ({ citationLabel })));
  const visible = stripModelCrossReferenceSuffixes(line);
  const found: string[] = [];
  for (const span of mentionSpans(visible, allowed)) {
    if (!span.admitted || !/^(?:Standing Orders?|SO|S\.O\.s?|Speakers?'? ruling|SR)\b/.test(span.mention)) continue;
    const tokens = standingTokens(span.mention) ?? [];
    const ruling = span.mention.match(/(?<!\d)\d{1,6}\/\d{1,6}(?!\d)/)?.[0] ?? "";
    for (const label of allowedLabels) {
      const forms = new Set(allowedProvisionForms(label));
      const hit = tokens.some((token) => tokenAdmitted(token, forms))
        || (ruling !== "" && (forms.has(ruling) || forms.has(`sr ${ruling}`)));
      if (hit && !found.includes(label)) found.push(label);
    }
  }
  return found;
}

export function claimRemovalCode(line: string, allowedLabels: Set<string>): ClaimRemovalCode {
  const citations = extractInlineCitations(line);
  if (citations.length === 0) return "no_citation";
  if (citations.some((citation) => !isCitationAllowed(citation, allowedLabels))) return "citation_not_admitted";
  return "no_citation";
}

export function pruneValidatedAnswerContent(input: {
  answerText: string;
  authorities: Array<{ citationLabel: string }>;
}): {
  prunedText: string;
  removedLines: string[];
  removalCodes: ClaimRemovalCode[];
} {
  const allowedLabels = new Set(
    input.authorities.map((authority) => authority.citationLabel),
  );
  const allowedForms = allowedSet(input.authorities);

  const lines = normalizeAnswerFormatting(input.answerText).split("\n");
  const kept: string[] = [];
  const removedLines: string[] = [];
  const removalCodes: ClaimRemovalCode[] = [];
  let currentSection: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimRight();
    const trimmed = line.trim();

    if (!trimmed) {
      kept.push("");
      continue;
    }

    if (isStructuralHeading(trimmed)) {
      currentSection = trimmed;
      kept.push(trimmed);
      continue;
    }

    if (currentSection === "Best authorities to inspect or cite:") {
      if (isLikelyBestAuthorityLine(trimmed)) {
        kept.push(line);
      } else {
        removedLines.push(line);
      }
      continue;
    }

    if (isSubstantiveSection(currentSection)) {
      if (lineHasAllowedCitation(trimmed, allowedLabels, allowedForms)) {
        kept.push(line);
      } else {
        const named = extractInlineCitations(trimmed).length === 0
          ? admittedLabelsNamedIn(trimmed, allowedLabels)
          : [];
        if (named.length > 0) {
          kept.push(`${line} ${named.map((label) => `[${label}]`).join(" ")}`);
        } else {
          removedLines.push(line);
          removalCodes.push(claimRemovalCode(trimmed, allowedLabels));
        }
      }
      continue;
    }

    kept.push(line);
  }

  const prunedText = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    prunedText,
    removedLines,
    removalCodes,
  };
}

/** Off in any production environment, hosted or not. */
export function firstDraftDebugEnabled(env: {
  OPEN_ORDER_DEBUG_FIRST_DRAFT?: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
} = process.env): boolean {
  if (env.OPEN_ORDER_DEBUG_FIRST_DRAFT !== "1") return false;
  if (env.NODE_ENV === "production") return false;
  if (env.VERCEL_ENV === "production") return false;
  return true;
}

/** A count only. Above 99 the reported count saturates at 99 and is not dropped. */
export function mentionRewriteEdit(count: number): string | null {
  if (!Number.isInteger(count) || count < 1) return null;
  return `removed_mentions=${Math.min(count, 99)}`;
}

const ACT_QUALIFICATION = "has not been confirmed to govern the specific act asked about.";
const FORUM_QUALIFICATION = "has not been confirmed to be the body the question is about.";

function lineCitesLabel(line: string, label: string): boolean {
  return citationTokensInBrackets(line).some((token) => citationTokenMatchesLabel(token, label));
}

const BLANKET_HEDGE = /(?:\[[^\]]+\]\s*)?has not been confirmed to (?:govern the specific act asked about|be the body the question is about)\.?/gi;

function labelKey(label: string): string {
  return label.trim().toLowerCase();
}

/** Put a real uncertainty on the claim it qualifies. Do not brand a settled provision. */
export function attachClaimQualifications(answerText: string, input: {
  actLabels?: string[];
  forumLabels?: string[];
  /** Admitted labels whose citation is grounded. Omit to keep the previous add-only behaviour. */
  groundedLabels?: string[];
  /** Provisions that are genuinely discretionary or conditional. Their qualification stays. */
  discretionaryLabels?: string[];
}): string {
  const actLabels = [...new Set((input.actLabels ?? []).map((label) => label.trim()).filter(Boolean))];
  const forumLabels = [...new Set((input.forumLabels ?? []).map((label) => label.trim()).filter(Boolean))];
  const grounded = input.groundedLabels === undefined
    ? null
    : new Set(input.groundedLabels.map(labelKey).filter(Boolean));
  const discretionary = new Set((input.discretionaryLabels ?? []).map(labelKey).filter(Boolean));
  const needsHedge = (label: string) => {
    const key = labelKey(label);
    if (discretionary.has(key)) return true;
    if (grounded === null) return true;
    return !grounded.has(key);
  };
  const substantive = new Set(["Bottom line:", "What this means:", "Your options:", "Risks or constraints:"]);
  const lines = String(answerText ?? "").split("\n");
  let section: string | null = null;
  const claimIndexes: number[] = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (substantive.has(trimmed) || trimmed === "Best authorities to inspect or cite:" || trimmed === "Possibly relevant, not confirmed to apply:" || trimmed === "Qualification:") {
      section = trimmed;
      return;
    }
    if (section && substantive.has(section) && trimmed) claimIndexes.push(index);
  });
  if (grounded !== null) {
    for (const index of claimIndexes) {
      const tokens = citationTokensInBrackets(lines[index] ?? "");
      const ungrounded = tokens.some((token) => !grounded.has(labelKey(token)));
      const keepsQualification = tokens.some((token) => discretionary.has(labelKey(token)));
      if (ungrounded || keepsQualification) continue;
      lines[index] = lines[index].replace(BLANKET_HEDGE, " ").replace(/[ \t]{2,}/g, " ").trimEnd();
    }
  }
  const citing = (label: string): number[] =>
    claimIndexes.filter((index) => lineCitesLabel(lines[index] ?? "", label));
  const append = (indexes: number[], sentence: string) => {
    for (const index of indexes) {
      if (lines[index].includes(sentence)) continue;
      lines[index] = `${lines[index]} ${sentence}`;
    }
  };
  const qualificationSection: string[] = [];
  const consider = (label: string, sentence: string) => {
    if (!needsHedge(label)) return;
    const hits = citing(label);
    if (hits.length > 0) append(hits, sentence);
    else if (!lines.join("\n").includes(sentence)) qualificationSection.push(sentence);
  };
  for (const label of actLabels) consider(label, `[${label}] ${ACT_QUALIFICATION}`);
  for (const label of forumLabels) consider(label, `[${label}] ${FORUM_QUALIFICATION}`);
  if (qualificationSection.length > 0) lines.push("", "Qualification:", ...qualificationSection);
  return lines.join("\n");
}

export type AnswerClaim = {
  id: string;
  lineIndex: number;
  text: string;
  citations: string[];
};

export function extractAnswerClaims(answerText: string): AnswerClaim[] {
  const lines = normalizeAnswerFormatting(answerText).split("\n");
  const claims: AnswerClaim[] = [];
  let currentSection: string | null = null;

  for (const [lineIndex, rawLine] of lines.entries()) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    if (isStructuralHeading(trimmed)) {
      currentSection = trimmed;
      continue;
    }

    if (!isSubstantiveSection(currentSection)) continue;

    const citations = extractInlineCitations(trimmed);
    if (citations.length === 0) continue;

    claims.push({
      id: `claim-${lineIndex + 1}`,
      lineIndex,
      text: trimmed,
      citations,
    });
  }

  return claims;
}

export function pruneUnsupportedAnswerClaims(input: {
  answerText: string;
  claims: AnswerClaim[];
  unsupportedClaimIds: string[];
}): {
  prunedText: string;
  removedClaims: AnswerClaim[];
} {
  const unsupported = new Set(input.unsupportedClaimIds);
  const removedClaims = input.claims.filter((claim) =>
    unsupported.has(claim.id),
  );

  if (removedClaims.length === 0) {
    return {
      prunedText: normalizeAnswerFormatting(input.answerText),
      removedClaims: [],
    };
  }

  const removedLineIndexes = new Set(
    removedClaims.map((claim) => claim.lineIndex),
  );

  const lines = normalizeAnswerFormatting(input.answerText).split("\n");
  const prunedText = lines
    .filter((_, lineIndex) => !removedLineIndexes.has(lineIndex))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    prunedText,
    removedClaims,
  };
}

export function appendEvidenceGapSection(
  answerText: string,
  evidenceGaps: string[],
): string {
  const gaps = evidenceGaps
    .map((gap) => normalizeWhitespace(gap))
    .filter(Boolean);

  if (gaps.length === 0) {
    return normalizeAnswerFormatting(answerText);
  }

  const rendered = gaps.map(
    (gap) =>
      `- Open Order did not retrieve authority establishing ${gap}. That unresolved point should not be treated as proved either way.`,
  );

  return [
    normalizeAnswerFormatting(answerText),
    "",
    "Evidence gap:",
    ...rendered,
  ]
    .join("\n")
    .trim();
}

function classifyOption(result: ProceduralSearchResult): string {
  const heading = result.heading ?? "Relevant authority";
  return `Inspect or cite ${heading} to test whether it directly governs the step in issue [${result.citationLabel}].`;
}

/** The stage word follows the stage that actually ran. A deadline before recovery is adjudication. */
export function withholdingStage(input: {
  adjudicated: boolean;
  recoveryRan: boolean;
  recoveryStatus?: string;
}): "selection" | "adjudication" | "recovery" {
  if (!input.adjudicated) return "selection";
  if (input.recoveryRan || input.recoveryStatus === "v40_no_governing_witness") return "recovery";
  return "adjudication";
}

export function buildFallbackAnswer(input: {
  question: string;
  planIntent: string;
  authorities: ProceduralSearchResult[];
  effectiveCorpus: string | null;
  fallbackReason: string;
  // v38: describe the actual failure boundary; do not claim that retrieved
  // evidence was absent merely because selection rejected every candidate.
  failureClass?: "selection" | "provider" | "validation" | "drafting_unavailable" | "validation_unavailable";
  retrievedEvidenceCount?: number;
  unconfirmedAuthorities?: ProceduralSearchResult[];
  withheldStage?: "selection" | "adjudication" | "recovery";
}): string {
  const best = input.authorities.slice(0, 4);
  const citations = best.map((authority) => `[${authority.citationLabel}]`);
  const foundButRejected = input.failureClass === "selection" &&
    (input.retrievedEvidenceCount ?? 0) > 0;
  const providerFailure = input.failureClass === "provider";
  const draftingUnavailable = input.failureClass === "drafting_unavailable";
  const validationUnavailable = input.failureClass === "validation_unavailable";

  const unconfirmed = input.unconfirmedAuthorities ?? [];
  const unconfirmedOnly = unconfirmed.length > 0 && best.length === 0;
  const withheldStage = input.withheldStage ?? "selection";
  const bottomLine = unconfirmedOnly
    ? "Sources were retrieved, but none was confirmed to govern the act asked about."
    : draftingUnavailable
    ? (best.length > 0
      ? `Answer generation did not complete; the selected authorities are available for inspection ${citations.join(" ")}.`
      : "Answer generation did not complete.")
    : validationUnavailable
      ? (best.length > 0
        ? `The claim check did not complete; the selected authorities are available for inspection ${citations.join(" ")}.`
        : "The claim check did not complete.")
      : providerFailure
        ? (best.length > 0
          ? `The AI provider could not complete an answer; the selected authorities are available below for inspection ${citations.join(" ")}.`
          : "The AI provider could not complete an answer.")
        : foundButRejected
          ? "Retrieval found possible authorities, but none passed source-grounded selection; no procedural conclusion can be made from this result."
          : best.length > 0
            ? `Relevant authorities were retrieved, but the drafted answer did not pass the checks ${citations.join(" ")}.`
            : "No sufficiently relevant authority was retrieved to support a procedural conclusion.";

  const whatThisMeans = foundButRejected
    ? "The retrieval candidates and the final authority selection are separate checks; the latter was inconclusive."
    : best.length > 0
      ? `Treat the authorities below as inspection points rather than as a synthesised answer ${citations[0]}.`
      : "A narrower search or additional authority is needed before giving procedural advice.";

  const options = best.length > 0 ? best.map(classifyOption) : [];

  const inspect =
    best.length > 0
      ? best
          .map((authority) => {
            const why =
              authority.heading?.trim() ||
              authority.path[authority.path.length - 1] ||
              "Relevant authority";

            return `- [${authority.citationLabel}] ${why}`;
          })
          .join("\n")
      : unconfirmedOnly
        ? "- Sources were retrieved, but none was confirmed to govern the act asked about."
        : foundButRejected
          ? `- Retrieved candidates were withheld at ${withheldStage}.`
          : "- No authorities were retrieved.";

  const unconfirmedList = unconfirmed;
  const unconfirmedText = unconfirmedList.length > 0
    ? [
      "Possibly relevant, not confirmed to apply:",
      ...unconfirmedList.map((authority) =>
        `- [${authority.citationLabel}] has not been confirmed to govern the specific act asked about. Check that it applies before relying on it.`),
    ].join("\n")
    : "";

  return [
    "Bottom line:",
    bottomLine,
    "",
    "What this means:",
    whatThisMeans,
    ...(options.length > 0 ? ["", "Your options:", ...options.map((option) => `- ${option}`)] : []),
    "",
    "Risks or constraints:",
    `- A substantive answer was withheld because ${
      input.failureClass === "drafting_unavailable" ? "answer generation did not complete" :
      input.failureClass === "validation_unavailable" ? "the claim check did not complete" :
      input.failureClass === "provider" ? "an answer could not be completed" :
      input.failureClass === "selection" ? "no source was confirmed to govern this question" :
      "the drafted answer could not be grounded in the retrieved sources"
    }.`,
    "",
    "Best authorities to inspect or cite:",
    inspect,
    ...(unconfirmedText ? ["", unconfirmedText] : []),
  ].join("\n");
}