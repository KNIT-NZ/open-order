// lib/procedural-reasoning.ts
import type { ProceduralSearchResult } from "@/lib/procedural-search";
import { cleanQuery } from "@/lib/search-core";
import {
  CONCEPT_REGISTRY,
  type AuthorityExclusionSpec,
  type AuthoritySlotSpec,
  type ProceduralConcept,
} from "./concept-registry";

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
  status: "promoted" | "rejected" | "covered_by_static";
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
  const anchor = result.sourceAnchor ? encodeURI(result.sourceAnchor) : null;

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
    sourceAnchor: result.sourceAnchor,
    sourceHref: buildSourceHref(result),
    rank: result.rank,
  }));
}

function hasAlias(question: string, concept: ProceduralConcept): boolean {
  const q = question.toLowerCase();
  return concept.aliases.some((alias) => q.includes(alias));
}

function getConceptById(id: ProceduralConcept["id"]): ProceduralConcept | null {
  return CONCEPT_REGISTRY.find((c) => c.id === id) ?? null;
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
  question: string,
  plannerQueries: string[] = [],
): ProceduralConcept[] {
  const q = question.toLowerCase();
  const matched = new Map<string, ProceduralConcept>();

  for (const concept of CONCEPT_REGISTRY) {
    if (hasAlias(q, concept)) {
      matched.set(concept.id, concept);
    }
  }

  if (
    q.includes("question to be put") ||
    q.includes("question be put") ||
    q.includes("premature")
  ) {
    const concept = getConceptById("closure_motion");
    if (concept) matched.set(concept.id, concept);
  }

  if (q.includes("point of order")) {
    const concept = getConceptById("point_of_order");
    if (concept) matched.set(concept.id, concept);
  }

  if (
    q.includes("committee of the whole") ||
    q.includes("committee stage")
  ) {
    const committee = getConceptById("committee_of_whole");
    if (committee) matched.set(committee.id, committee);

    const chair = getConceptById("chair_control");
    if (chair) matched.set(chair.id, chair);
  }

  if (
    q.includes("racist") ||
    q.includes("racism") ||
    q.includes("country of origin") ||
    q.includes("right to speak") ||
    q.includes("ethnicity") ||
    q.includes("nationality")
  ) {
    const personal = getConceptById("personal_reflection");
    if (personal) matched.set(personal.id, personal);

    const racism = getConceptById("allegation_of_racism");
    if (racism) matched.set(racism.id, racism);
  }

  if (
    q.includes("evasive") ||
    q.includes("relevancy") ||
    q.includes("relevant") ||
    q.includes("back on track")
  ) {
    const relevancy = getConceptById("relevancy");
    if (relevancy) matched.set(relevancy.id, relevancy);
  }

  if (
    q.includes("accountability to the house") ||
    q.includes("account to the house") ||
    q.includes("avoid directly answering") ||
    q.includes("non-answer")
  ) {
    const accountability = getConceptById("ministerial_accountability");
    if (accountability) matched.set(accountability.id, accountability);
  }

  if (
    q.includes("yesterday") ||
    q.includes("previous sitting") ||
    q.includes("require an apology") ||
    q.includes("require a member to apologise")
  ) {
    const retrospective = getConceptById("retrospective_discipline");
    if (retrospective) matched.set(retrospective.id, retrospective);

    const withdrawal = getConceptById("withdrawal_and_apology");
    if (withdrawal) matched.set(withdrawal.id, withdrawal);
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
  const q = cleanQuery(query).toLowerCase();
  if (!q) return [];

  const aliases: Record<string, string[]> = {
    "question to be put": ["closure motion"],
    "question be put": ["closure motion"],
    premature: ["closure motion", "acceptance of closure motion"],
    evasive: ["relevancy"],
    evasiveness: ["relevancy"],
    "back on track": ["relevancy"],
    "country of origin": ["personal reflections", "against members"],
    nationality: ["personal reflections", "against members"],
    ethnicity: ["personal reflections", "against members"],
    racist: ["allegations of racism"],
    racism: ["allegations of racism"],
    "borderline racist": ["allegations of racism"],
    "right to speak": ["against members", "personal reflections"],
    "chairperson relevancy committee of the whole": [
      "chairperson",
      "relevancy",
      "point of order",
    ],
    "committee of the whole chairperson": ["chairperson"],
    "chairperson relevancy": ["chairperson", "relevancy"],
    "point of order relevancy": ["point of order", "relevancy"],
    "relevancy committee of the whole": ["relevancy", "chairperson"],
  };

  if (aliases[q]) return aliases[q];

  if (
    q.includes("committee of the whole") &&
    q.includes("chairperson") &&
    q.includes("relevancy")
  ) {
    return ["chairperson", "relevancy", "point of order"];
  }

  if (q.includes("point of order") && q.includes("relevancy")) {
    return ["point of order", "relevancy"];
  }

  if (q.includes("chairperson") && q.includes("relevancy")) {
    return ["chairperson", "relevancy"];
  }

  return [query];
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
    isAgainstMembers ||
    isAllegationsOfRacism ||
    isRelevancy ||
    isClosure
  ) {
    authorityClass = "governing_rule";
  } else if (
    isAcceptance ||
    isEffect ||
    heading === "procedure" ||
    heading === "form of reply" ||
    heading === "withdrawal"
  ) {
    authorityClass = "constraint_or_qualification";
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
  result: ProceduralSearchResult,
  requiredTextIncludes?: string[],
): boolean {
  if (!requiredTextIncludes || requiredTextIncludes.length === 0) return true;

  const content = result.sectionContent.toLowerCase();
  return requiredTextIncludes.some((phrase) =>
    content.includes(phrase.toLowerCase()),
  );
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
  const profile = buildAuthorityProfile(input.result);
  const query = input.query.toLowerCase();

  let boost = 0;

  if (input.frame.committeeOfWhole) {
    if (profile.isCommitteeOfWhole) boost += 120;
    if (profile.isChairperson && profile.isCommitteeOfWhole) boost += 140;
    if (profile.isSelectCommitteeChairpersons) boost -= 260;
  }

  if (input.frame.memberConduct) {
    if (profile.isPersonalReflections) boost += 140;
    if (profile.isAgainstMembers) boost += 160;
    if (profile.isAllegationsOfRacism) boost += 180;
    if (profile.heading === "procedure" && profile.isPersonalReflections)
      boost += 120;
    if (profile.pathText.includes("judiciary")) boost -= 180;
    if (profile.pathText.includes("questions to ministers and members"))
      boost -= 180;
  }

  if (input.frame.closure) {
    if (profile.heading.includes("closure")) boost += 140;
    if (profile.pathText.includes("closure of debate")) boost += 120;
    if (profile.isPointsOfOrder) boost += 60;
  }

  if (input.frame.relevancy) {
    if (profile.isRelevancy) boost += 130;
    if (profile.isCommitteeOfWhole && profile.isChairperson) boost += 100;
  }

  if (input.frame.ministerialAccountability) {
    if (profile.heading === "accountability to the house") boost += 170;
    if (profile.heading === "form of reply") boost += 150;
    if (profile.isPointsOfOrder) boost += 80;
  }

  if (input.frame.retrospectiveDiscipline) {
    if (profile.heading === "withdrawal") boost += 170;
    if (profile.heading === "procedure") boost += 130;
    if (profile.isPointsOfOrder) boost += 70;
  }

  if (query.includes("point of order") && profile.isPointsOfOrder) boost += 100;
  if (query.includes("relevancy") && profile.isRelevancy) boost += 90;
  if (query.includes("chairperson") && profile.isChairperson) boost += 90;
  if (query.includes("against members") && profile.isAgainstMembers) boost += 110;
  if (query.includes("allegations of racism") && profile.isAllegationsOfRacism)
    boost += 120;
  if (query.includes("closure motion") && profile.isClosure) boost += 100;

  return boost;
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

    const promotedByExactHeading =
      evidence.exactHeadingCount >= 1 &&
      (evidence.maxRank >= 120 || evidence.results.length >= 2);
    const promotedByHeadingCluster =
      evidence.headingPhraseCount >= 2 && evidence.maxRank >= 180;

    // A corpus bridge begins with a weak semantic breadcrumb. Searching the
    // breadcrumb heading will necessarily create an exact-heading match, so
    // exactness alone would be circular evidence. Require a coherent
    // multi-authority heading family before a bridge may create a concept.
    const promotedByCorpusBridge =
      evidence.results.length >= 2 &&
      evidence.maxClusterSupportCount >= 2 &&
      evidence.maxRank >= 180 &&
      (evidence.exactHeadingCount >= 2 || evidence.headingPhraseCount >= 2);

    const promoted =
      provenance === "corpus_bridge"
        ? promotedByCorpusBridge
        : promotedByExactHeading || promotedByHeadingCluster;
    const key = discoveryKey(evidence.heading || query);

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
            : `Promoted from a coherent heading-phrase cluster of ${evidence.results.length} results.`
        : provenance === "corpus_bridge"
          ? "The breadcrumb heading did not show enough independent multi-authority corpus support to create a runtime concept."
          : "Heading evidence was present but did not meet the promotion threshold.",
      heading: evidence.heading,
      evidenceCount: evidence.results.length,
      slotKey: promoted ? `discovered_${key}` : null,
      bridgeSourceQuery,
      bridgeSourceCitationLabel,
    });
  }

  return output;
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

    const breadcrumb = search.results.slice(0, 3).find((result) => {
      const heading = result.heading?.trim();
      if (!heading) return false;

      const normalizedHeading = normalizeHeadingForDiscovery(heading);
      if (CORPUS_BRIDGE_STOP_HEADINGS.has(normalizedHeading)) return false;
      if (normalizedHeading === normalizeConceptTrigger(search.query)) {
        return false;
      }

      const headingSearch: SearchExecution = {
        query: heading,
        corpus: result.documentCorpus,
        provenance: "corpus_bridge",
        results: [],
      };
      if (
        searchDimensionCoveredByStaticConcept(
          headingSearch,
          frame.activeConcepts,
        )
      ) {
        return false;
      }

      const corpus =
        result.documentCorpus === "standing_orders" ||
        result.documentCorpus === "speakers_rulings"
          ? result.documentCorpus
          : null;
      const key = `${corpus ?? "auto"}::${normalizeConceptTrigger(heading)}`;
      return !existingSearchKeys.has(key);
    });

    if (!breadcrumb?.heading) continue;

    const corpus =
      breadcrumb.documentCorpus === "standing_orders" ||
      breadcrumb.documentCorpus === "speakers_rulings"
        ? breadcrumb.documentCorpus
        : search.corpus === "standing_orders" ||
            search.corpus === "speakers_rulings"
          ? search.corpus
          : null;

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
      requirement: "required",
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

function countTextMatches(
  content: string,
  phrases: string[],
): number {
  return phrases.filter((phrase) =>
    content.includes(phrase.toLowerCase()),
  ).length;
}

function scorePreferredText(
  result: ProceduralSearchResult,
  slot: AuthoritySlotSpec,
): number {
  const preferred = slot.preferredTextIncludes ?? [];
  if (preferred.length === 0) return 0;

  const content = result.sectionContent.toLowerCase();
  return countTextMatches(content, preferred) * 120;
}

function contextPreferenceApplies(
  activeConceptIds: Set<string>,
  preference: NonNullable<AuthoritySlotSpec["contextualTextPreferences"]>[number],
): boolean {
  const any = preference.whenAnyConcepts ?? [];
  const all = preference.whenAllConcepts ?? [];

  const anySatisfied =
    any.length === 0 || any.some((conceptId) => activeConceptIds.has(conceptId));
  const allSatisfied =
    all.length === 0 || all.every((conceptId) => activeConceptIds.has(conceptId));

  return anySatisfied && allSatisfied;
}

function scoreContextualBridgeText(
  result: ProceduralSearchResult,
  slot: AuthoritySlotSpec,
  activeConceptIds: Set<string>,
): number {
  const preferences = slot.contextualTextPreferences ?? [];
  if (preferences.length === 0) return 0;

  const content = result.sectionContent.toLowerCase();

  return preferences.reduce((score, preference) => {
    if (!contextPreferenceApplies(activeConceptIds, preference)) {
      return score;
    }

    const matches = countTextMatches(content, preference.textIncludes);
    const bonusPerMatch = preference.bonusPerMatch ?? 180;
    return score + matches * bonusPerMatch;
  }, 0);
}

function scoreDiscoveryBreadcrumb(
  result: ProceduralSearchResult,
  discoveries: DiscoveredProceduralDimension[],
): number {
  const resultHeading = result.heading
    ? normalizeHeadingForDiscovery(result.heading)
    : null;

  return discoveries.reduce((score, discovery) => {
    if (
      discovery.status !== "promoted" ||
      discovery.provenance !== "corpus_bridge" ||
      !discovery.heading ||
      !discovery.bridgeSourceCitationLabel ||
      discovery.bridgeSourceCitationLabel !== result.citationLabel ||
      !resultHeading ||
      resultHeading !== normalizeHeadingForDiscovery(discovery.heading)
    ) {
      return score;
    }

    // Once the heading family has independently passed bridge validation,
    // prefer the original semantic breadcrumb within that validated family.
    return score + 260;
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
  const discoveredSlots = buildDiscoveredSlots(
    discoveredDimensions,
    input.searches,
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

  const defaultMaxAuthorities =
    slots.length > 0 ? Math.max(1, Math.min(slots.length, 8)) : 4;

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
    lower.includes("cited in") ||
    /\bso\s+\d+/i.test(citation) ||
    /\bstanding order\s+\d+/i.test(citation)
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

function stripBracketedCitations(text: string): string {
  return text.replace(/\[[^\]]+\]/g, " ");
}

function normalizeAuthorityMention(text: string): string {
  return text
    .replace(/^standing order\s+/i, "SO ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function validateAnswerAuthorityMentions(input: {
  answerText: string;
  authorities: Array<{ citationLabel: string }>;
}): { ok: true } | { ok: false; invalidAuthorityMentions: string[] } {
  const allowed = new Set(
    input.authorities.map((a) => normalizeAuthorityMention(a.citationLabel)),
  );

  const prose = stripBracketedCitations(input.answerText);

  const matches = [
    ...new Set(
      prose.match(/\b(?:standing order|so)\s+\d+[a-z]?|\b\d+\/\d+\b/gi) ?? [],
    ),
  ];

  const invalid = matches.filter((m) => {
    const normalized = normalizeAuthorityMention(m);
    return !allowed.has(normalized);
  });

  if (invalid.length > 0) {
    return { ok: false, invalidAuthorityMentions: invalid };
  }

  return { ok: true };
}

export function rewriteForbiddenAuthorityMentions(input: {
  answerText: string;
  authorities: Array<{ citationLabel: string }>;
}): {
  rewrittenText: string;
  removedMentions: string[];
} {
  const allowed = new Set(
    input.authorities.map((a) => normalizeAuthorityMention(a.citationLabel)),
  );

  const pattern = /\b(?:standing order|so)\s+\d+[a-z]?|\b\d+\/\d+\b/gi;
  const removed: string[] = [];

  const rewritten = input.answerText.replace(pattern, (match) => {
    const normalized = normalizeAuthorityMention(match);

    if (allowed.has(normalized)) {
      return match;
    }

    removed.push(match);
    return "the retrieved authority";
  });

  return {
    rewrittenText: rewritten,
    removedMentions: [...new Set(removed)],
  };
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

  const invalidCitations = [
    ...new Set(
      cited.filter(
        (citation) =>
          !isCitationAllowed(citation, allowedLabels) ||
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
): boolean {
  const citations = extractInlineCitations(line);
  if (citations.length === 0) return false;
  return citations.every((citation) => isCitationAllowed(citation, allowedLabels));
}

function isLikelyBestAuthorityLine(line: string): boolean {
  return /^\-\s*\[[^\]]+\]/.test(line.trim()) || /^\-\s*\S+/.test(line.trim());
}

export function pruneValidatedAnswerContent(input: {
  answerText: string;
  authorities: Array<{ citationLabel: string }>;
}): {
  prunedText: string;
  removedLines: string[];
} {
  const allowedLabels = new Set(
    input.authorities.map((authority) => authority.citationLabel),
  );

  const lines = normalizeAnswerFormatting(input.answerText).split("\n");
  const kept: string[] = [];
  const removedLines: string[] = [];
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
      if (lineHasAllowedCitation(trimmed, allowedLabels)) {
        kept.push(line);
      } else {
        removedLines.push(line);
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
  };
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

export function buildFallbackAnswer(input: {
  question: string;
  planIntent: string;
  authorities: ProceduralSearchResult[];
  effectiveCorpus: string | null;
  fallbackReason: string;
}): string {
  const best = input.authorities.slice(0, 4);
  const citations = best.map((authority) => `[${authority.citationLabel}]`);

  const bottomLine =
    best.length > 0
      ? `Relevant authorities were retrieved, but the drafted answer did not pass the grounding checks, so I cannot safely state a stronger procedural conclusion from this result set ${citations.join(" ")}.`
      : "No sufficiently relevant authority was retrieved to support a procedural conclusion.";

  const whatThisMeans =
    best.length > 0
      ? `Treat the authorities below as inspection points rather than as a synthesised answer ${citations[0]}.`
      : "A narrower search or additional authority is needed before giving procedural advice.";

  const options =
    best.length > 0
      ? best.map(classifyOption)
      : ["No clearly relevant authority was retrieved."];

  const inspect =
    best.length > 0
      ? best
          .map((authority) => {
            const profile = buildAuthorityProfile(authority);
            const why =
              authority.heading?.trim() ||
              authority.path[authority.path.length - 1] ||
              "Relevant authority";

            return `- [${authority.citationLabel}] ${why} (${profile.authorityClass}; ${profile.authorityFunction})`;
          })
          .join("\n")
      : "- No strong authorities were retrieved.";

  return [
    "Bottom line:",
    bottomLine,
    "",
    "What this means:",
    whatThisMeans,
    "",
    "Your options:",
    ...options.map((option) => `- ${option}`),
    "",
    "Risks or constraints:",
    `- A substantive answer was withheld because validation failed: ${input.fallbackReason}`,
    "",
    "Best authorities to inspect or cite:",
    inspect,
  ].join("\n");
}