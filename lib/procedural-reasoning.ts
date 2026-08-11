// lib/procedural-reasoning.ts
import type { ProceduralSearchResult } from "@/lib/procedural-search";
import { cleanQuery } from "@/lib/search-core";
import {
  CONCEPT_REGISTRY,
  type AuthorityExclusionSpec,
  type AuthoritySlotSpec,
  type ProceduralConcept,
} from "./concept-registry";

export type SearchExecution = {
  query: string;
  corpus: string | null;
  results: ProceduralSearchResult[];
};

export type AuthorityClass =
  | "governing_rule"
  | "chair_control"
  | "procedural_mechanism"
  | "constraint_or_qualification"
  | "analogy_or_support"
  | "miscellaneous";

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
};

export type ScoredAuthority = {
  result: ProceduralSearchResult;
  query: string;
  queryIndex: number;
  routeBoost: number;
  slotBoost: number;
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

export function inferConcepts(question: string): ProceduralConcept[] {
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

  return [...matched.values()];
}

function deriveFrame(question: string): DerivedFrame {
  const activeConcepts = inferConcepts(question);
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

function uniqQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const raw of queries) {
    const canonicalized = canonicalizeProceduralQuery(raw);

    for (const candidate of canonicalized) {
      const query = cleanQuery(candidate);
      if (!query) continue;

      const key = query.toLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      output.push(query);
    }
  }

  return output;
}

export function expandPlannerQueries(input: {
  question: string;
  plannerQueries: string[];
  effectiveCorpus: string | null;
}): string[] {
  const frame = deriveFrame(input.question);
  const seedQueries = [...input.plannerQueries];
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

  return uniqQueries([...seedQueries, ...conceptQueries, ...additions]).slice(
    0,
    6,
  );
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
  } else if (isAcceptance || isEffect || heading === "procedure" || heading === "form of reply" || heading === "withdrawal") {
    authorityClass = "constraint_or_qualification";
  } else if (isRulesOfDebate || isCommitteeStage || isPersonalReflections) {
    authorityClass = "analogy_or_support";
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

function corpusMatches(
  result: ProceduralSearchResult,
  preferredCorpora?: Array<"standing_orders" | "speakers_rulings">,
): boolean {
  if (!preferredCorpora || preferredCorpora.length === 0) return true;
  return preferredCorpora.includes(
    result.documentCorpus as "standing_orders" | "speakers_rulings",
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
    corpusMatches(result, slot.preferredCorpora)
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

function buildBlueprintSlots(concepts: ProceduralConcept[]): AuthoritySlotSpec[] {
  const seen = new Set<string>();
  const slots: AuthoritySlotSpec[] = [];

  for (const concept of concepts) {
    for (const slot of concept.slots) {
      if (seen.has(slot.key)) continue;
      seen.add(slot.key);
      slots.push(slot);
    }
  }

  return slots;
}

function scoreSlotMatches(
  result: ProceduralSearchResult,
  slots: AuthoritySlotSpec[],
): { matchedSlotKeys: string[]; slotBoost: number } {
  const matchedSlotKeys = slots
    .filter((slot) => matchesSlot(result, slot))
    .map((slot) => slot.key);

  const slotBoost = matchedSlotKeys.length * 180;

  return { matchedSlotKeys, slotBoost };
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
  maxAuthorities?: number;
}): {
  finalAuthorities: ProceduralSearchResult[];
  scoredAuthorities: ScoredAuthority[];
  activeConceptIds: string[];
  blueprintSlots: string[];
  selectedSlotMatches: SlotMatch[];
} {
  const frame = deriveFrame(input.question);
  const slots = buildBlueprintSlots(frame.activeConcepts);

  const flattened: ScoredAuthority[] = input.searches.flatMap(
    (search, queryIndex) =>
      search.results.map((result) => {
        const routeBoost = scoreContextualAuthority({
          result,
          query: search.query,
          frame,
        });

        const { matchedSlotKeys, slotBoost } = scoreSlotMatches(result, slots);

        return {
          result,
          query: search.query,
          queryIndex,
          routeBoost,
          slotBoost,
          adjustedRank: result.rank + routeBoost + slotBoost,
          matchedSlotKeys,
        };
      }),
  );

  const sorted = [...flattened].sort((a, b) => {
    if (b.adjustedRank !== a.adjustedRank)
      return b.adjustedRank - a.adjustedRank;
    if (b.slotBoost !== a.slotBoost) return b.slotBoost - a.slotBoost;
    if (b.routeBoost !== a.routeBoost) return b.routeBoost - a.routeBoost;
    if (b.result.rank !== a.result.rank) return b.result.rank - a.result.rank;
    return a.result.citationLabel.localeCompare(b.result.citationLabel);
  });

  const deduped = dedupeScoredAuthorities(sorted);
  const selected: ScoredAuthority[] = [];
  const seen = new Set<string>();
  const familyCounts = new Map<string, number>();
  const selectedSlotMatches: SlotMatch[] = [];

  const computedMaxAuthorities = Math.min(
    10,
    Math.max(
      4,
      input.maxAuthorities ??
        frame.activeConcepts.reduce(
          (sum, concept) => sum + (concept.defaultPackContribution ?? 0),
          2,
        ),
    ),
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
      selectedSlotMatches.push({
        slotKey,
        citationLabel: item.result.citationLabel,
        heading: item.result.heading,
      });
    }
  }

  for (const slot of slots) {
    const candidate = deduped.find(
      (item) => item.matchedSlotKeys.includes(slot.key) && canAdd(item),
    );
    if (candidate) add(candidate);
  }

  for (const item of deduped) {
    if (selected.length >= computedMaxAuthorities) break;
    if (!canAdd(item)) continue;
    add(item);
  }

  return {
    finalAuthorities: selected.map((item) => ({
      ...item.result,
      rank: item.adjustedRank,
    })),
    scoredAuthorities: selected,
    activeConceptIds: frame.activeConcepts.map((c) => c.id),
    blueprintSlots: slots.map((slot) => slot.key),
    selectedSlotMatches,
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

function classifyConstraint(result: ProceduralSearchResult): string | null {
  const heading = (result.heading ?? "").toLowerCase();
  const path = result.path.join(" > ").toLowerCase();
  const text = result.sectionContent.toLowerCase();

  if (
    heading.includes("acceptance") ||
    heading.includes("speaker") ||
    text.includes("if the speaker accepts") ||
    text.includes("speaker accepts") ||
    path.includes("chairperson")
  ) {
    return `This appears to depend on whether the Chair accepts the procedural step [${result.citationLabel}].`;
  }

  if (
    heading.includes("effect") ||
    text.includes("unless ") ||
    text.includes("except ") ||
    heading === "form of reply" ||
    heading === "withdrawal"
  ) {
    return `This authority states conditions or consequences that may constrain what happens next [${result.citationLabel}].`;
  }

  return null;
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
  const frame = deriveFrame(input.question);
  const top = input.authorities.slice(0, 6);
  const best = top.length > 0 ? top : [];
  const cite = (index: number) =>
    best[index] ? `[${best[index].citationLabel}]` : "";

  let bottomLine =
    `The retrieved authorities are too thin to give a confident procedural answer ${cite(
      0,
    )}`.trim();

  let whatThisMeans =
    `The retrieval plan ran, but the result set was not strong enough to support a reliable grounded answer ${cite(
      0,
    )}`.trim();

  let options: string[] =
    best.length > 0
      ? best.slice(0, 3).map(classifyOption)
      : ["No clearly relevant authority was retrieved."];

  let constraints: string[] = best
    .map(classifyConstraint)
    .filter((item): item is string => Boolean(item))
    .slice(0, 2);

  if (best.length > 0) {
    if (frame.closure) {
      bottomLine =
        `A member can argue by point of order that accepting a closure motion would be unreasonable at that stage, but the Chair decides whether closure is accepted [${best
          .map((a) => a.citationLabel)
          .slice(0, 3)
          .join("] [")}].`;

      whatThisMeans =
        `The strongest grounded pack combines the closure rule, the acceptance constraint, and the point-of-order mechanism, rather than a freestanding rule that debate must continue [${best
          .map((a) => a.citationLabel)
          .slice(0, 3)
          .join("] [")}].`;

      options = [
        `Wait for a closure motion to be formally moved, then immediately take a point of order and argue that accepting it would be unreasonable at that stage [${best
          .map((a) => a.citationLabel)
          .slice(0, 3)
          .join("] [")}].`,
        `Frame the objection around whether closure should be accepted, not around a claimed absolute right to continue debating [${best
          .map((a) => a.citationLabel)
          .slice(0, 2)
          .join("] [")}].`,
      ];

      constraints = [
        `The Chair retains the acceptance judgment, so the move is arguable but not self-executing [${best
          .map((a) => a.citationLabel)
          .slice(0, 2)
          .join("] [")}].`,
      ];
    } else if (frame.memberConduct) {
      bottomLine =
        `The strongest grounded move is to frame the issue as a personal reflection against a member and ask the Chair to intervene [${best
          .map((a) => a.citationLabel)
          .slice(0, 3)
          .join("] [")}].`;

      whatThisMeans =
        `The most on-point authorities are the personal-reflections rulings, especially Against members, Procedure, and, where relevant, Allegations of racism [${best
          .map((a) => a.citationLabel)
          .slice(0, 3)
          .join("] [")}].`;

      options = [
        `Rise immediately on a point of order and frame the conduct as a personal reflection against a member [${best
          .map((a) => a.citationLabel)
          .slice(0, 3)
          .join("] [")}].`,
        `Ask the Chair to require the remark to be withdrawn or checked procedurally rather than debating the politics of the remark itself [${best
          .map((a) => a.citationLabel)
          .slice(0, 3)
          .join("] [")}].`,
      ];

      constraints = [
        `The safest path is procedural intervention through the Chair, not a broad substantive argument about motives [${best
          .map((a) => a.citationLabel)
          .slice(0, 3)
          .join("] [")}].`,
      ];
    } else if (frame.committeeOfWhole && frame.relevancy) {
      bottomLine =
        `The grounded position is that the Chair can be asked, by point of order, to require relevance in committee of the whole [${best
          .map((a) => a.citationLabel)
          .slice(0, 3)
          .join("] [")}].`;

      whatThisMeans =
        `The strongest pack combines the Chairperson ruling, Relevancy, and the point-of-order mechanism, all directed to the matter before the committee [${best
          .map((a) => a.citationLabel)
          .slice(0, 3)
          .join("] [")}].`;

      options = [
        `Take a point of order and ask the Chair to require the member or Minister to address the matter before the committee [${best
          .map((a) => a.citationLabel)
          .slice(0, 3)
          .join("] [")}].`,
        `Frame the intervention as one of relevance and committee control, not merely dissatisfaction with the quality of the answer [${best
          .map((a) => a.citationLabel)
          .slice(0, 3)
          .join("] [")}].`,
      ];

      constraints = [
        `The Chair controls proceedings in committee, so the practical question is whether the Chair accepts the relevance point [${best
          .map((a) => a.citationLabel)
          .slice(0, 3)
          .join("] [")}].`,
      ];
    }
  }

  const optionsText = options.map((item) => `- ${item}`).join("\n");
  const constraintsText = constraints.map((item) => `- ${item}`).join("\n");

  const orderedForInspection = [...best].sort((a, b) => {
    const pa = buildAuthorityProfile(a);
    const pb = buildAuthorityProfile(b);

    const weight = (profile: AuthorityProfile) => {
      switch (profile.authorityClass) {
        case "governing_rule":
          return 1;
        case "procedural_mechanism":
          return 2;
        case "chair_control":
          return 3;
        case "constraint_or_qualification":
          return 4;
        case "analogy_or_support":
          return 5;
        default:
          return 6;
      }
    };

    const wa = weight(pa);
    const wb = weight(pb);

    if (wa !== wb) return wa - wb;
    return b.rank - a.rank;
  });

  const inspect =
    orderedForInspection.length > 0
      ? orderedForInspection
          .slice(0, 4)
          .map((authority) => {
            const profile = buildAuthorityProfile(authority);
            const label =
              profile.authorityClass === "governing_rule"
                ? "governing rule"
                : profile.authorityClass === "chair_control"
                  ? "chair control"
                  : profile.authorityClass === "procedural_mechanism"
                    ? "procedural mechanism"
                    : profile.authorityClass === "constraint_or_qualification"
                      ? "constraint or qualification"
                      : "supporting authority";

            const why = authority.heading?.trim()
              ? authority.heading
              : authority.path[authority.path.length - 1] ?? "Relevant authority";

            return `- [${authority.citationLabel}] ${why} (${label})`;
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
    optionsText || "- No clearly relevant authority was retrieved.",
    "",
    "Risks or constraints:",
    constraintsText ||
      `- This fallback cannot confidently synthesise constraints beyond the retrieved authorities ${
        cite(0) || ""
      }`.trim(),
    "",
    "Best authorities to inspect or cite:",
    inspect,
    "",
    `- Fallback note: the AI draft was not trusted because validation failed (${input.fallbackReason}).`,
  ].join("\n");
}