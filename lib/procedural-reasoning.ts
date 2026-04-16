// lib/procedural-reasoning.ts
import type { ProceduralSearchResult } from "@/lib/procedural-search";
import { cleanQuery } from "@/lib/search-core";

import { CONCEPT_REGISTRY, type ProceduralConcept } from "./concept-registry";

export function inferConcepts(question: string): ProceduralConcept[] {
  const q = question.toLowerCase();
  const context = detectQuestionContext(question);
  const matched = new Map<string, ProceduralConcept>();

  for (const concept of CONCEPT_REGISTRY) {
    if (concept.aliases.some((alias) => q.includes(alias))) {
      matched.set(concept.id, concept);
    }
  }

  if (context.closure) {
    const concept = CONCEPT_REGISTRY.find((c) => c.id === "closure_motion");
    if (concept) matched.set(concept.id, concept);
  }

  if (context.pointOfOrder) {
    const concept = CONCEPT_REGISTRY.find((c) => c.id === "point_of_order");
    if (concept) matched.set(concept.id, concept);
  }

  if (context.memberConduct) {
    const personalReflection = CONCEPT_REGISTRY.find(
      (c) => c.id === "personal_reflection",
    );
    if (personalReflection)
      matched.set(personalReflection.id, personalReflection);

    if (context.racismOrRacist || context.nationalityOrOriginAttack) {
      const racism = CONCEPT_REGISTRY.find(
        (c) => c.id === "allegation_of_racism",
      );
      if (racism) matched.set(racism.id, racism);
    }
  }

  if (context.relevancy) {
    const relevancy = CONCEPT_REGISTRY.find((c) => c.id === "relevancy");
    if (relevancy) matched.set(relevancy.id, relevancy);
  }

  if (context.committeeOfWhole) {
    const committee = CONCEPT_REGISTRY.find(
      (c) => c.id === "committee_of_whole",
    );
    if (committee) matched.set(committee.id, committee);

    const chair = CONCEPT_REGISTRY.find((c) => c.id === "chair_control");
    if (chair) matched.set(chair.id, chair);
  }

  if (context.ministerialAccountability) {
    const accountability = CONCEPT_REGISTRY.find(
      (c) => c.id === "ministerial_accountability",
    );
    if (accountability) matched.set(accountability.id, accountability);
  }

  if (context.retrospectiveDiscipline) {
    const retrospective = CONCEPT_REGISTRY.find(
      (c) => c.id === "retrospective_discipline",
    );
    if (retrospective) matched.set(retrospective.id, retrospective);

    const withdrawal = CONCEPT_REGISTRY.find(
      (c) => c.id === "withdrawal_and_apology",
    );
    if (withdrawal) matched.set(withdrawal.id, withdrawal);
  }

  return [...matched.values()];
}

export type QuestionContext = {
  committeeOfWhole: boolean;
  memberConduct: boolean;
  nationalityOrOriginAttack: boolean;
  racismOrRacist: boolean;
  closure: boolean;
  relevancy: boolean;
  pointOfOrder: boolean;
  ministerialAccountability: boolean;
  retrospectiveDiscipline: boolean;
};

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
  adjustedRank: number;
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

export function detectQuestionContext(question: string): QuestionContext {
  const q = question.toLowerCase();

  return {
    committeeOfWhole:
      q.includes("committee of the whole") || q.includes("committee stage"),
    memberConduct:
      q.includes("unparliamentary") ||
      q.includes("racist") ||
      q.includes("racism") ||
      q.includes("right to speak") ||
      q.includes("personal reflection") ||
      q.includes("country of origin") ||
      q.includes("origin of another member") ||
      q.includes("ethnicity") ||
      q.includes("nationality"),
    nationalityOrOriginAttack:
      q.includes("country of origin") ||
      q.includes("origin of another member") ||
      q.includes("right to speak"),
    racismOrRacist:
      q.includes("racist") ||
      q.includes("racism") ||
      q.includes("borderline racist"),
    closure:
      q.includes("question to be put") ||
      q.includes("question be put") ||
      q.includes("closure") ||
      q.includes("debate is nowhere near finished") ||
      q.includes("premature"),
    relevancy:
      q.includes("relevant") ||
      q.includes("relevancy") ||
      q.includes("evasive") ||
      q.includes("back on track"),
    pointOfOrder: q.includes("point of order"),
    ministerialAccountability:
      q.includes("areas of responsibility") ||
      q.includes("account to the house") ||
      q.includes("accountability to the house") ||
      q.includes("avoid directly answering") ||
      q.includes("abdication of responsibility") ||
      q.includes("non-answer"),
    retrospectiveDiscipline:
      q.includes("yesterday") ||
      q.includes("previous sitting") ||
      q.includes("require a member to apologise") ||
      q.includes("require an apology") ||
      q.includes("something that happened in the house yesterday"),
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

  if (aliases[q]) {
    return aliases[q];
  }

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
  const inferredConcepts = inferConcepts(input.question);
  const context = detectQuestionContext(input.question);
  const seedQueries = [...input.plannerQueries];

  const rewritten = seedQueries.flatMap((query) => {
    const q = query.toLowerCase();

    if (q === "speaker's discretion closure") {
      return ["closure motion", "acceptance of closure motion"];
    }

    if (
      input.effectiveCorpus === "speakers_rulings" &&
      q === "procedure" &&
      context.memberConduct
    ) {
      return ["personal reflections procedure"];
    }

    if (
      input.effectiveCorpus === "speakers_rulings" &&
      q === "chairperson" &&
      context.committeeOfWhole
    ) {
      return ["chairperson"];
    }

    if (
      input.effectiveCorpus === "speakers_rulings" &&
      q === "relevancy committee of the whole"
    ) {
      return ["relevancy", "chairperson"];
    }

    if (
      input.effectiveCorpus === "speakers_rulings" &&
      q === "chairperson relevancy"
    ) {
      return ["chairperson", "relevancy"];
    }

    if (
      input.effectiveCorpus === "speakers_rulings" &&
      q === "point of order relevancy"
    ) {
      return ["point of order", "relevancy"];
    }

    if (
      input.effectiveCorpus === "speakers_rulings" &&
      q === "committee of the whole chairperson"
    ) {
      return ["chairperson"];
    }

    return [query];
  });

  const additions: string[] = [];

  if (context.closure) {
    additions.push("closure motion", "acceptance of closure motion");
    additions.push("point of order");
    if (input.effectiveCorpus !== "standing_orders") {
      additions.push("closure of debate");
    }
  }

  if (context.memberConduct) {
    additions.push("personal reflections", "against members");
    if (context.racismOrRacist || context.nationalityOrOriginAttack) {
      additions.push("allegations of racism");
    }
    if (input.effectiveCorpus === "speakers_rulings") {
      additions.push("personal reflections procedure");
    }
  }

  if (context.committeeOfWhole) {
    additions.push("chairperson");
  }

  if (context.relevancy) {
    additions.push("relevancy");
    if (input.effectiveCorpus === "speakers_rulings") {
      additions.push("point of order");
    }
  }

  if (context.pointOfOrder) {
    additions.push("point of order");
  }

  const conceptQueries = inferredConcepts.flatMap((c) => c.preferredQueries);

  return uniqQueries([...rewritten, ...additions, ...conceptQueries]).slice(
    0,
    5,
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
  const isPointsOfOrder = heading === "points of order";
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
  } else if (isAcceptance || isEffect || heading === "procedure") {
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

function isRouteExcluded(
  result: ProceduralSearchResult,
  question: string,
): boolean {
  const context = detectQuestionContext(question);
  const profile = buildAuthorityProfile(result);

  if (context.committeeOfWhole && context.relevancy) {
    if (profile.isSelectCommitteeChairpersons) return true;
  }

  if (context.memberConduct) {
    if (profile.pathText.includes("judiciary")) return true;
    if (profile.pathText.includes("questions to ministers and members"))
      return true;
  }

  return false;
}

function scoreContextualAuthority(input: {
  result: ProceduralSearchResult;
  query: string;
  question: string;
}): number {
  const context = detectQuestionContext(input.question);
  const profile = buildAuthorityProfile(input.result);
  const query = input.query.toLowerCase();

  let boost = 0;

  if (context.committeeOfWhole) {
    if (profile.isCommitteeOfWhole) boost += 420;
    if (profile.isChairperson && profile.isCommitteeOfWhole) boost += 260;
    if (profile.isRulesOfDebate && profile.isRelevancy) boost += 180;
    if (profile.isCommitteeStage && profile.isRelevancy) boost += 40;
    if (profile.isCommitteeStage && !query.includes("amendment")) boost -= 120;
    if (profile.isSelectCommitteeChairpersons) boost -= 520;
  }

  if (context.memberConduct) {
    if (profile.isPersonalReflections) boost += 420;
    if (profile.isAgainstMembers) boost += 280;
    if (profile.isAllegationsOfRacism) boost += 320;
    if (profile.heading === "procedure" && profile.isPersonalReflections)
      boost += 220;
    if (profile.pathText.includes("unparliamentary language")) boost += 60;
    if (profile.pathText.includes("judiciary")) boost -= 320;
    if (profile.pathText.includes("questions to ministers and members"))
      boost -= 260;
  }

  if (context.closure) {
    if (profile.heading.includes("closure")) boost += 240;
    if (profile.pathText.includes("closure of debate")) boost += 220;
    if (
      input.result.documentCorpus === "standing_orders" &&
      profile.heading.includes("closure")
    ) {
      boost += 120;
    }
    if (profile.isPointsOfOrder) boost += 80;
  }

  if (context.relevancy) {
    if (profile.isRelevancy) boost += 180;
    if (profile.isRulesOfDebate && profile.isRelevancy) boost += 140;
    if (profile.isCommitteeOfWhole && profile.isChairperson) boost += 200;
    if (
      profile.isCommitteeStage &&
      profile.isRelevancy &&
      !query.includes("amendment")
    ) {
      boost -= 80;
    }
  }

  if (query.includes("committee of the whole") && profile.isCommitteeOfWhole) {
    boost += 180;
  }

  if (query.includes("against members") && profile.isAgainstMembers) {
    boost += 260;
  }

  if (
    query.includes("allegations of racism") &&
    profile.isAllegationsOfRacism
  ) {
    boost += 300;
  }

  if (query.includes("personal reflections") && profile.isPersonalReflections) {
    boost += 220;
  }

  if (
    query.includes("chairperson") &&
    profile.isChairperson &&
    profile.isCommitteeOfWhole
  ) {
    boost += 220;
  }

  if (query.includes("point of order") && profile.isPointsOfOrder) {
    boost += 180;
  }

  if (query.includes("relevancy") && profile.isRelevancy) {
    boost += 160;
  }

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

export function selectFinalAuthorities(input: {
  searches: SearchExecution[];
  question: string;
  maxAuthorities?: number;
}): {
  finalAuthorities: ProceduralSearchResult[];
  scoredAuthorities: ScoredAuthority[];
} {
  const inferredConcepts = inferConcepts(input.question);
  const context = detectQuestionContext(input.question);

  const flattened: ScoredAuthority[] = input.searches.flatMap(
    (search, queryIndex) =>
      search.results.map((result) => {
        const routeBoost = scoreContextualAuthority({
          result,
          query: search.query,
          question: input.question,
        });

        return {
          result,
          query: search.query,
          queryIndex,
          routeBoost,
          adjustedRank: result.rank + routeBoost,
        };
      }),
  );

  const sorted = [...flattened].sort((a, b) => {
    if (b.adjustedRank !== a.adjustedRank)
      return b.adjustedRank - a.adjustedRank;
    if (b.routeBoost !== a.routeBoost) return b.routeBoost - a.routeBoost;
    if (b.result.rank !== a.result.rank) return b.result.rank - a.result.rank;
    return a.result.citationLabel.localeCompare(b.result.citationLabel);
  });

  const deduped = dedupeScoredAuthorities(sorted);
  const selected: ScoredAuthority[] = [];
  const seen = new Set<string>();
  const headingPathCounts = new Map<string, number>();
  const classCounts = new Map<AuthorityClass, number>();
  const maxAuthorities = input.maxAuthorities ?? 10;

  function profileKey(item: ScoredAuthority): string {
    const heading = (item.result.heading ?? "none").toLowerCase();
    const pathTail = item.result.path.slice(-2).join(" > ").toLowerCase();
    return `${heading}::${pathTail}`;
  }

  function maxPerFamily(item: ScoredAuthority): number {
    const profile = buildAuthorityProfile(item.result);

    if (context.memberConduct) {
      if (profile.isAgainstMembers) return 1;
      if (profile.isAllegationsOfRacism) return 1;
      if (profile.isPersonalReflections && profile.heading === "procedure")
        return 1;
    }

    if (context.committeeOfWhole && context.relevancy) {
      if (profile.isCommitteeOfWhole && profile.isChairperson) return 1;
      if (profile.isRulesOfDebate && profile.isRelevancy) return 2;
      if (profile.isCommitteeStage && profile.isRelevancy) return 1;
      if (profile.isPointsOfOrder) return 1;
    }

    if (context.closure) {
      const heading = (item.result.heading ?? "").toLowerCase();
      const path = item.result.path.join(" > ").toLowerCase();
      if (heading.includes("closure") || path.includes("closure of debate"))
        return 3;
      if (profile.isPointsOfOrder) return 1;
    }

    if (context.ministerialAccountability) {
      const heading = (item.result.heading ?? "").toLowerCase();
      if (heading === "accountability to the house") return 1;
      if (heading === "form of reply") return 1;
      if (profile.isPointsOfOrder) return 1;
    }

    if (context.retrospectiveDiscipline) {
      const heading = (item.result.heading ?? "").toLowerCase();
      if (heading === "withdrawal") return 1;
      if (heading === "procedure") return 1;
      if (profile.isPointsOfOrder) return 1;
    }

    return 2;
  }

  function passesMinimumThreshold(item: ScoredAuthority): boolean {
    if (item.routeBoost > 0) return true;
    if (item.adjustedRank >= 120) return true;
    if (item.result.matchSignals.exactSectionKeyMatch) return true;
    if (item.result.matchSignals.exactCitationMatch) return true;
    if (item.result.matchSignals.exactHeadingMatch) return true;
    if (item.result.matchSignals.headingPhraseMatch) return true;
    if (item.result.matchSignals.pathPhraseMatch) return true;
    return false;
  }

  function canAdd(item: ScoredAuthority): boolean {
    if (seen.has(item.result.sectionId)) return false;
    if (isRouteExcluded(item.result, input.question)) return false;
    if (!passesMinimumThreshold(item)) return false;

    const key = profileKey(item);
    const count = headingPathCounts.get(key) ?? 0;
    return count < maxPerFamily(item);
  }

  function add(item: ScoredAuthority) {
    selected.push(item);
    seen.add(item.result.sectionId);
    const key = profileKey(item);
    headingPathCounts.set(key, (headingPathCounts.get(key) ?? 0) + 1);

    const profile = buildAuthorityProfile(item.result);
    classCounts.set(
      profile.authorityClass,
      (classCounts.get(profile.authorityClass) ?? 0) + 1,
    );
  }

  function take(
    predicate: (item: ScoredAuthority) => boolean,
    maxToTake: number,
  ) {
    for (const item of deduped) {
      if (selected.length >= maxAuthorities) break;
      if (maxToTake <= 0) break;
      if (!predicate(item)) continue;
      if (!canAdd(item)) continue;

      add(item);
      maxToTake -= 1;
    }
  }

  function takeByClass(
    authorityClass: AuthorityClass,
    maxToTake: number,
    extraPredicate?: (item: ScoredAuthority) => boolean,
  ) {
    take((item) => {
      const profile = buildAuthorityProfile(item.result);
      if (profile.authorityClass !== authorityClass) return false;
      return extraPredicate ? extraPredicate(item) : true;
    }, maxToTake);
  }

  function hasAuthority(
    predicate: (item: ScoredAuthority) => boolean,
  ): boolean {
    return selected.some(predicate);
  }

  function blueprintSatisfied(): boolean {
    if (context.closure) {
      const hasClosureRule = hasAuthority((item) => {
        const profile = buildAuthorityProfile(item.result);
        return profile.isClosure && profile.authorityClass === "governing_rule";
      });

      const hasClosureQualification = hasAuthority((item) => {
        const profile = buildAuthorityProfile(item.result);
        return profile.isAcceptance || profile.isEffect;
      });

      const hasPointOfOrder = hasAuthority((item) => {
        const profile = buildAuthorityProfile(item.result);
        return profile.isPointsOfOrder;
      });

      return hasClosureRule && hasClosureQualification && hasPointOfOrder;
    }

    if (context.memberConduct) {
      const hasAgainstMembers = hasAuthority((item) => {
        const profile = buildAuthorityProfile(item.result);
        return profile.isAgainstMembers;
      });

      const hasRacism = hasAuthority((item) => {
        const profile = buildAuthorityProfile(item.result);
        return profile.isAllegationsOfRacism;
      });

      const hasProcedure = hasAuthority((item) => {
        const profile = buildAuthorityProfile(item.result);
        return profile.isPersonalReflections && profile.heading === "procedure";
      });

      return hasAgainstMembers && hasRacism && hasProcedure;
    }

    if (context.committeeOfWhole && context.relevancy) {
      const hasChairperson = hasAuthority((item) => {
        const profile = buildAuthorityProfile(item.result);
        return profile.isCommitteeOfWhole && profile.isChairperson;
      });

      const hasRelevancy = hasAuthority((item) => {
        const profile = buildAuthorityProfile(item.result);
        return (
          profile.isRelevancy && profile.authorityClass === "governing_rule"
        );
      });

      const hasPointOfOrder = hasAuthority((item) => {
        const profile = buildAuthorityProfile(item.result);
        return profile.isPointsOfOrder;
      });

      return hasChairperson && hasRelevancy && hasPointOfOrder;
    }

    if (context.ministerialAccountability) {
      const hasAccountability = hasAuthority((item) => {
        const heading = (item.result.heading ?? "").toLowerCase();
        return heading === "accountability to the house";
      });

      const hasFormOfReply = hasAuthority((item) => {
        const heading = (item.result.heading ?? "").toLowerCase();
        return heading === "form of reply";
      });

      const hasPointOfOrder = hasAuthority((item) => {
        const profile = buildAuthorityProfile(item.result);
        return profile.isPointsOfOrder;
      });

      return hasAccountability && hasFormOfReply && hasPointOfOrder;
    }

    if (context.retrospectiveDiscipline) {
      const hasWithdrawal = hasAuthority((item) => {
        const heading = (item.result.heading ?? "").toLowerCase();
        return heading === "withdrawal";
      });

      const hasProcedure = hasAuthority((item) => {
        const heading = (item.result.heading ?? "").toLowerCase();
        return heading === "procedure";
      });

      const hasPointOfOrder = hasAuthority((item) => {
        const profile = buildAuthorityProfile(item.result);
        return profile.isPointsOfOrder;
      });

      return hasWithdrawal && hasProcedure && hasPointOfOrder;
    }

    return false;
  }

  if (context.closure) {
    take((item) => {
      const profile = buildAuthorityProfile(item.result);
      return profile.isClosure && profile.authorityClass === "governing_rule";
    }, 1);

    take((item) => {
      const profile = buildAuthorityProfile(item.result);
      return profile.isAcceptance || profile.isEffect;
    }, 1);

    takeByClass("procedural_mechanism", 1, (item) => {
      const profile = buildAuthorityProfile(item.result);
      return profile.isPointsOfOrder;
    });

    takeByClass("chair_control", 1);
  }

  if (context.memberConduct) {
    take((item) => {
      const profile = buildAuthorityProfile(item.result);
      return profile.isAgainstMembers;
    }, 1);

    take((item) => {
      const profile = buildAuthorityProfile(item.result);
      return profile.isAllegationsOfRacism;
    }, 1);

    take((item) => {
      const profile = buildAuthorityProfile(item.result);
      return profile.isPersonalReflections && profile.heading === "procedure";
    }, 1);

    takeByClass("chair_control", 1);
  }

  if (context.committeeOfWhole && context.relevancy) {
    take((item) => {
      const profile = buildAuthorityProfile(item.result);
      return profile.isCommitteeOfWhole && profile.isChairperson;
    }, 1);

    take((item) => {
      const profile = buildAuthorityProfile(item.result);
      return profile.isRelevancy && profile.authorityClass === "governing_rule";
    }, 1);

    takeByClass("procedural_mechanism", 1, (item) => {
      const profile = buildAuthorityProfile(item.result);
      return profile.isPointsOfOrder;
    });

    takeByClass("constraint_or_qualification", 1);
  }

  if (context.ministerialAccountability) {
    take((item) => {
      const heading = (item.result.heading ?? "").toLowerCase();
      return heading === "accountability to the house";
    }, 1);

    take((item) => {
      const heading = (item.result.heading ?? "").toLowerCase();
      return heading === "form of reply";
    }, 1);

    takeByClass("procedural_mechanism", 1, (item) => {
      const profile = buildAuthorityProfile(item.result);
      return profile.isPointsOfOrder;
    });
  }

  if (context.retrospectiveDiscipline) {
    take((item) => {
      const heading = (item.result.heading ?? "").toLowerCase();
      return heading === "withdrawal";
    }, 1);

    take((item) => {
      const heading = (item.result.heading ?? "").toLowerCase();
      return heading === "procedure";
    }, 1);

    takeByClass("procedural_mechanism", 1, (item) => {
      const profile = buildAuthorityProfile(item.result);
      return profile.isPointsOfOrder;
    });
  }

  if (!blueprintSatisfied()) {
    for (const item of deduped) {
      if (selected.length >= maxAuthorities) break;
      if (!canAdd(item)) continue;
      add(item);
    }
  }

  return {
    finalAuthorities: selected.map((item) => ({
      ...item.result,
      rank: item.adjustedRank,
    })),
    scoredAuthorities: selected,
  };
}

export function normalizeAnswerFormatting(text: string): string {
  return text
    .replace(/^\*\s+/gm, "- ")
    .replace(/^\*\*\s+/gm, "- ")
    .replace(/^\*\s{2,}/gm, "- ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
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
      return match; // keep valid
    }

    removed.push(match);

    // rewrite strategy: soften instead of delete abruptly
    return "that authority";
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

function classifyConstraint(result: ProceduralSearchResult): string | null {
  const heading = (result.heading ?? "").toLowerCase();
  const path = result.path.join(" > ").toLowerCase();
  const text = result.sectionContent.toLowerCase();

  if (
    heading.includes("acceptance") ||
    heading.includes("speaker") ||
    text.includes("if the speaker accepts") ||
    text.includes("speaker accepts") ||
    path.includes("speaker")
  ) {
    return `${result.citationLabel}: this appears to depend on whether the Chair accepts the procedural step.`;
  }

  if (
    heading.includes("effect") ||
    text.includes("if ") ||
    text.includes("unless ") ||
    text.includes("except ")
  ) {
    return `${result.citationLabel}: this provision appears to describe conditions or consequences that may constrain what happens next.`;
  }

  return null;
}

function classifyOption(result: ProceduralSearchResult): string {
  const heading = result.heading ?? "Relevant authority";
  return `Inspect ${result.citationLabel} (${heading}) to test whether it directly governs the tactic in issue.`;
}

export function buildFallbackAnswer(input: {
  question: string;
  planIntent: string;
  authorities: ProceduralSearchResult[];
  effectiveCorpus: string | null;
  fallbackReason: string;
}): string {
  const context = detectQuestionContext(input.question);
  const top = input.authorities.slice(0, 6);
  const best = top.length > 0 ? top : [];

  let bottomLine =
    "The retrieved authorities are too thin to give a confident procedural answer.";
  let whatThisMeans =
    "The retrieval plan ran, but the result set was not strong enough to support a reliable grounded answer.";

  let options: string[] =
    best.length > 0
      ? best.slice(0, 3).map(classifyOption)
      : ["No clearly relevant authority was retrieved."];

  let constraints: string[] = best
    .map(classifyConstraint)
    .filter((item): item is string => Boolean(item))
    .slice(0, 2);

  if (best.length > 0) {
    if (context.closure) {
      bottomLine =
        "Yes. The grounded position is that a member can use a point of order to argue that accepting a closure motion would be unreasonable at that stage of debate.";
      whatThisMeans =
        "The retrieved authorities point to the closure-motion rules plus the general point-of-order mechanism. That does not let a member conclusively rule that debate is unfinished, but it does let them put the objection squarely before the Chair.";
      options = [
        "Wait for a closure motion to be formally moved, then immediately take a point of order and argue that accepting it would be unreasonable at this stage.",
        "Anchor the objection in the Chair’s judgment about whether closure should be accepted, rather than claiming there is a freestanding rule that debate must continue.",
        "Keep the objection procedural and brief so it is clearly a point of order rather than further debate.",
      ];
      constraints = [
        "The Standing Orders do not create a separate test called 'debate is nowhere near finished'; the issue is whether the Chair treats closure as reasonable.",
        "If members are merely shouting for the question informally, there may be nothing formally before the Chair until a closure motion is actually moved.",
      ];
    } else if (context.memberConduct) {
      bottomLine =
        "The strongest grounded move is to raise the matter immediately as a personal reflection against a member and press the Chair to intervene.";
      whatThisMeans =
        "The retrieved authorities cluster under Personal reflections, especially Against members and Allegations of racism. That suggests the best procedural framing is not a vague complaint about tone, but a direct objection to a personal reflection on a member.";
      options = [
        "Rise immediately on a point of order and frame the conduct as a personal reflection against a member.",
        "Press the Chair to require the offending remark to be withdrawn or stopped, rather than arguing the broader politics of the exchange.",
        "If the language crosses into accusations of racism or identity-based attack, use that framing carefully but keep the complaint tied to the House’s rules on personal reflections.",
      ];
      constraints = [
        "The strongest route is procedural discipline through the Chair, not a substantive rebuttal in debate.",
        "Overstating the complaint can weaken it; the safest framing is that the member’s remarks improperly reflect on another member and their standing to speak.",
      ];
    } else if (context.committeeOfWhole && context.relevancy) {
      bottomLine =
        "The grounded position is that the Chair can be asked, by point of order, to require the Minister to stay relevant in committee of the whole.";
      whatThisMeans =
        "The retrieved authorities point to Relevancy rulings and the Chairperson's control of proceedings in committee. The safest procedural move is to frame the complaint as one of relevance and ask the Chair to bring the Minister back to the matter before the committee.";
      options = [
        "Take a point of order and ask the Chair to require the Minister to address the matter actually before the committee.",
        "Frame the intervention as a relevance complaint, not a complaint about tone or quality of answer.",
        "If needed, repeat the point in more pointed but still procedural language: the Minister is not engaging with the issue before the committee.",
      ];
      constraints = [
        "The Chair has control of proceedings in committee, so the practical issue is persuading the Chair to act.",
        "The safest route is relevance; broader accusations of evasiveness may sound political unless tied back to the subject before the committee.",
      ];
    } else {
      bottomLine = `The safest grounded view is that this issue should be analysed through ${best
        .slice(0, 3)
        .map((authority) => `[${authority.citationLabel}]`)
        .join(", ")}.`;
      whatThisMeans =
        "The retrieved authorities are relevant, but not strong enough to support a sharper synthesis. Treat the leading authorities as indicating what the rules most likely establish, what may depend on the Chair, and where the position remains uncertain.";
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
              : (authority.path[authority.path.length - 1] ??
                "Relevant authority");

            return `- ${authority.citationLabel}: ${why} (${label})`;
          })
          .join("\n")
      : "- No strong authorities were retrieved.";

  return [
    "Bottom line",
    bottomLine,
    "",
    "What this means",
    whatThisMeans,
    "",
    "Your options",
    optionsText || "- No clearly relevant authority was retrieved.",
    "",
    "Risks or constraints",
    constraintsText ||
      "- This fallback cannot confidently synthesise constraints beyond the retrieved authorities.",
    "",
    "Best authorities to inspect",
    inspect,
    "",
    `Fallback note: the AI draft was not trusted. Reason: ${input.fallbackReason}`,
  ].join("\n");
}
