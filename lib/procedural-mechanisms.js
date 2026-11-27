/**
 * Generic procedural mechanisms.
 * Retrieval- or relation-driven. No topic catalogues, authority sentences,
 * benchmark ids, or fixed admission scores.
 */

const STOP = new Set([
  "a", "an", "the", "of", "to", "and", "in", "or", "on", "at", "for", "by",
  "is", "are", "be", "do", "does", "with", "as", "it", "that", "this", "from",
  "after", "before", "about", "under", "into", "their", "them", "who", "what",
  "when", "where", "which", "how", "not", "no",
]);

const ONES = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const NUMBER_WORD = { ...ONES, ...TEENS, ...TENS, hundred: 100 };

export const FALLBACK_REASONS = [
  "none",
  "no_authority_selected",
  "empty_draft",
  "prune_emptied_draft",
  "invalid_citations",
  "ungrounded_mentions",
  "no_grounded_claims",
  "not_responsive",
  "validation_rejected",
  "bottom_line_lost",
  "drafting_unavailable",
  "validation_unavailable",
  "sources_insufficient",
];

export const STREAM_ERROR_REASONS = [
  "invalid_request",
  "deadline_exceeded",
  "provider_rate_limited",
  "provider_unavailable",
  "provider_upstream",
  "internal",
];

export function stem(token) {
  const value = String(token ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (value.length > 5 && value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.length > 5 && value.endsWith("ing")) return value.slice(0, -3);
  if (value.length > 4 && value.endsWith("ed")) return value.slice(0, -2);
  if (value.length > 4 && value.endsWith("es")) return value.slice(0, -2);
  if (value.length > 4 && value.endsWith("s")) return value.slice(0, -1);
  return value;
}

export function contentTokens(text) {
  return [...new Set(String(text ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .map(stem).filter((token) => token.length >= 4 && !STOP.has(token)))];
}

function sharesPrefix(left, right) {
  if (!left || !right || left.length < 4 || right.length < 4) return false;
  return left.slice(0, 4) === right.slice(0, 4);
}

export function normaliseNumberWords(text) {
  return String(text ?? "")
    .replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[-\s](one|two|three|four|five|six|seven|eight|nine)\b/gi,
      (_, ten, one) => String(TENS[ten.toLowerCase()] + ONES[one.toLowerCase()]))
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/gi,
      (word) => String(NUMBER_WORD[word.toLowerCase()]));
}

export function routeFromPlanner(situationKind) {
  return situationKind === "incident" ? "incident_adjudication" : "semantic_selector";
}

export function mustAdjudicateFromPlanner(kind, hasLegacy) {
  if (!hasLegacy) return true;
  return kind === "incident";
}

export function relationsFromPlanner(input) {
  const decision = `${input?.situation?.decisionQuestion ?? ""} ${input?.situation?.action ?? ""}`.toLowerCase();
  const relations = new Set();
  if (/\b(?:may not|must not|shall not|cannot|prohibited)\b/.test(decision)) relations.add("prohibition");
  else if (/\b(?:may|can|could|permitted|allowed)\b/.test(decision)) relations.add("permission");
  if (/\b(?:must|shall|required|duty|obliged)\b/.test(decision)) relations.add("requirement");
  if (/\b(?:discretion|whether)\b/.test(decision) || (/\b(?:may|can)\b/.test(decision) && /\b(?:decide|determine|consider)\b/.test(decision))) {
    relations.add("discretion");
  }
  if (/\b(?:after|before|once|when|while|reopen|closed)\b/.test(decision)) relations.add("timing");
  if (/\b(?:if|unless|provided)\b/.test(decision)) relations.add("condition");
  if (/\b(?:who|which actor|which body)\b/.test(decision)) relations.add("actor_scope");
  if (input?.intent === "options" || input?.intent === "tactic") relations.add("procedure");
  if (relations.size === 0) relations.add("rule");
  return [...relations];
}

export function authorisingRuleQueries(situation) {
  const action = String(situation?.action ?? "").replace(/\s+/g, " ").trim();
  if (action.length < 3 || action.length > 90) return [];
  const decision = `${situation?.decisionQuestion ?? ""} ${action}`;
  if (!/\b(?:may|can|could|authoris|permit|allowed|power)\b/i.test(decision)) return [];
  return [action];
}

export function stageReopeningQueries(situation) {
  const moment = `${situation?.proceduralMoment ?? ""} ${situation?.decisionQuestion ?? ""}`;
  const action = `${situation?.action ?? ""} ${situation?.decisionQuestion ?? ""}`;
  const closed = /\b(?:after|once|following|closed|concluded|completed|finished)\b/i.test(moment);
  const alters = /\b(?:amend|alter|chang|modif|reopen|revis)\w*/i.test(action);
  return closed && alters ? ["reopening a concluded stage"] : [];
}

export function proceedingConsequenceQueries(situation) {
  const text = `${situation?.decisionQuestion ?? ""} ${situation?.action ?? ""} ${situation?.setting ?? ""} ${situation?.proceduralMoment ?? ""}`;
  const consequence = /\b(?:liab\w*|immun\w*|privilege|suable|actionable)\b/i.test(text);
  const proceeding = /\b(?:proceeding|debate|speech|sitting)\b/i.test(text);
  return consequence && proceeding ? ["privilege and immunity of proceedings"] : [];
}

export function errorCorrectionQueries(situation) {
  const text = `${situation?.decisionQuestion ?? ""} ${situation?.action ?? ""}`;
  const challenge = /\b(?:challenge|correct|error|mistake|recount)\b/i.test(text);
  const recorded = /\b(?:recorded|record|result|count|outcome|vote|decision)\b/i.test(text);
  return challenge && recorded ? ["correction of an erroneous recorded outcome"] : [];
}

export function presidingOfficerAppealQuery(situation) {
  const text = `${situation?.actor ?? ""} ${situation?.action ?? ""} ${situation?.decisionQuestion ?? ""}`;
  const appeal = /\b(?:appeal|challenge)\b/i.test(text);
  const officer = /\b(?:presiding|speaker|chair|chairperson)\b/i.test(text);
  const ruling = /\b(?:ruling|decision)\b/i.test(text);
  return appeal && officer && ruling ? "appeal from a presiding officer" : null;
}

export function actorClassQualificationQuery(actor) {
  const text = String(actor ?? "").replace(/\s+/g, " ").trim();
  if (!text || !/\b(?:only|except|other than|not a|non-|who is not|who are not|unless)\b/i.test(text)) return null;
  const cleaned = text.replace(/\b(?:only|except|other than|not a|non-|who is not|who are not|unless)\b/gi, " ")
    .replace(/\s+/g, " ").trim();
  return cleaned ? `qualifications on ${cleaned}`.slice(0, 90) : null;
}

export function splitActAndObject(action) {
  const tokens = contentTokens(action);
  if (tokens.length < 2) return { act: tokens, object: tokens };
  return { act: [tokens[0]], object: tokens.slice(1) };
}

export function quoteAttestsActAndObject(quote, action) {
  const parts = splitActAndObject(action);
  if (parts.act.length === 0 || parts.object.length === 0) return true;
  if (parts.object.length === 1 && parts.object[0] === parts.act[0]) return true;
  const quoteTokens = contentTokens(quote);
  const has = (token) => quoteTokens.some((item) => item === token || sharesPrefix(item, token));
  return has(parts.act[0]) && parts.object.some(has);
}

export function procedureHomonymMismatch(question, heading) {
  const match = String(heading ?? "").toLowerCase().match(/\b(\w+?)ing\s+(?:a|the|an)\s+([a-z]{3,})/);
  if (!match) return null;
  const verbStem = stem(match[1]);
  const object = stem(match[2]);
  const questionTokens = contentTokens(question);
  const usesVerb = questionTokens.some((token) => token === verbStem || sharesPrefix(token, verbStem));
  const sameObject = questionTokens.some((token) => token === object || sharesPrefix(token, object));
  return usesVerb && !sameObject ? "procedure-homonym" : null;
}

export function forumIdentityMismatch(setting, path) {
  const asked = contentTokens(setting);
  if (asked.length === 0) return null;
  for (const segment of path ?? []) {
    const tokens = contentTokens(segment);
    if (tokens.length < 2) continue;
    const shared = tokens.filter((token) => asked.some((item) => item === token || sharesPrefix(item, token)));
    if (shared.length === 0) continue;
    const askedOnly = asked.filter((token) => !tokens.some((item) => item === token || sharesPrefix(item, token)));
    const pathOnly = tokens.filter((token) => !asked.some((item) => item === token || sharesPrefix(item, token)));
    if (askedOnly.length > 0 && pathOnly.length > 0) return "forum-identity";
  }
  return null;
}

export function expressCrossReferences(text) {
  const refs = new Set();
  for (const match of String(text ?? "").matchAll(/\b(?:standing order|so)\s+(\d+[a-z]*)\b/gi)) {
    refs.add(`SO ${match[1].toUpperCase()}`);
  }
  for (const match of String(text ?? "").matchAll(/\b(\d+\/\d+)\b/g)) refs.add(match[1]);
  return [...refs];
}

export function isApplicabilityRejection(reason) {
  return /^(?:scope-not-established|forum-identity|procedure-homonym|act-not-attested|recording-permission)/.test(String(reason ?? ""));
}

export function negativePowerWitnessScore(input) {
  const source = String(input?.source ?? "").toLowerCase();
  const actorTokens = contentTokens(input?.actor ?? "");
  const actTokens = contentTokens(input?.act ?? "");
  if (!source || actorTokens.length === 0 || actTokens.length === 0) return 0;
  const sourceTokens = contentTokens(source);
  const actorHit = actorTokens.some((token) => sourceTokens.some((item) => item === token || sharesPrefix(item, token)));
  const lacks = /\b(?:cannot|may not|must not|shall not|has no power|no power|not entitled)\b/i.test(source)
    || /\b(?:must|shall)\b/i.test(source);
  if (!actorHit || !lacks) return 0;
  const found = actTokens.filter((token) => sourceTokens.some((item) => item === token || sharesPrefix(item, token))).length;
  return found === 0 ? 0 : found / actTokens.length;
}

export function powerGrantedToDifferentBody(askedBody, source) {
  const match = String(source ?? "").match(/\b(?:the|a|any)\s+((?:[a-z]+\s+){0,4}[a-z]+)\s+may\b/i);
  if (!match) return false;
  const grantee = contentTokens(match[1]);
  const asked = contentTokens(askedBody);
  if (grantee.length === 0 || asked.length === 0) return false;
  const same = asked.some((token) => grantee.some((item) => item === token || sharesPrefix(item, token)));
  if (same && !/\b(?:other|another)\b/i.test(match[1])) return false;
  return /\b(?:other|another)\b/i.test(match[1]) || !same;
}

export function dutyVersusDiscretion(text) {
  const duty = /\b(?:must|shall|required to|is to)\b/i.test(text);
  const discretion = /\b(?:\bmay\b|discretion)\b/i.test(text);
  if (duty && discretion) return "either";
  if (duty) return "duty";
  if (discretion) return "discretion";
  return "unspecified";
}

export function exceptionNamesAuthorisingBody(clause) {
  return /\b(?:except|unless|provided that|subject to)\b/i.test(clause)
    && /\b(?:the|a)\s+[a-z]+(?:\s+[a-z]+){0,3}\b/i.test(clause)
    && /\b(?:authoris|approv|consent|leave|permit|direct)\w*/i.test(clause);
}

export function usableSourceAnchor(anchor) {
  if (typeof anchor !== "string") return null;
  const trimmed = anchor.trim();
  if (!trimmed || /^none$/i.test(trimmed)) return null;
  return trimmed;
}

export function isStructuredTableRow(line) {
  const text = String(line ?? "").trim();
  if (text.length < 8 || text.length > 420) return false;
  if (text.includes("|") || text.includes("\t")) return true;
  if (/\S+\s{2,}\S+/.test(text)) return true;
  return /^[^:]{2,80}:\s+\S/.test(text);
}

export function isStructuredTableSection(content) {
  return String(content ?? "").split(/\n/).some(isStructuredTableRow);
}

export function tableVocabularyCovers(query, heading, path, content) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).map((word) => word.replace(/[^a-z0-9]/g, "")).filter((word) => word.length >= 4);
  if (words.length < 2 || !isStructuredTableSection(content)) return false;
  const hay = `${heading ?? ""} ${(path ?? []).join(" ")} ${content ?? ""}`.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4);
  const strong = (word) => hay.some((token) => token === word || token.startsWith(word.slice(0, 4)) || word.startsWith(token.slice(0, 4)) || stem(token) === stem(word));
  const weak = (word) => hay.some((token) => token.slice(0, 3) === word.slice(0, 3));
  const strongHits = words.filter(strong).length;
  return strongHits === words.length || (strongHits >= words.length - 1 && words.some((word) => !strong(word) && weak(word)));
}

export function insufficiencyFacets(answerText) {
  const facets = [];
  const text = String(answerText ?? "");
  if (/^evidence gaps?:/im.test(text)) facets.push("evidence_gap");
  const sentences = text.split(/(?<=[.?!])\s+/);
  const structural = /\b(?:retrieved (?:material|sources|authorities)|selected sources|the sources|the authorities|the evidence)\b[^.?!]{0,80}\b(?:do not|does not|cannot|can't|insufficient|not sufficient|do not establish|does not establish|do not settle|does not settle)\b/i;
  const direct = /\b(?:evidence|sources|authorities)\b[^.?!]{0,40}\b(?:is|are)\s+insufficient\b/i;
  if (sentences.some((sentence) => structural.test(sentence) || direct.test(sentence))) {
    facets.push("sources_do_not_settle");
  }
  return facets;
}

export function obligationPartialFacets(details) {
  return (details ?? []).flatMap((detail, index) => detail?.complete ? [] : [`obligation:${index + 1}:coverage=${Number(detail?.coverage ?? 0)}`]);
}

const BODY_SECTIONS = new Set(["Bottom line:", "What this means:", "Your options:", "Risks or constraints:"]);

export function answerSections(answerText) {
  const sections = [];
  let current = { heading: "", lines: [] };
  for (const line of String(answerText ?? "").split("\n")) {
    const trimmed = line.trim();
    if (/^[A-Z][^:\n]{0,80}:$/.test(trimmed) || BODY_SECTIONS.has(trimmed) || trimmed === "Best authorities to inspect or cite:") {
      sections.push(current);
      current = { heading: trimmed, lines: [] };
    } else current.lines.push(line);
  }
  sections.push(current);
  return sections;
}

export function citationLabelsIn(text) {
  const labels = new Set();
  for (const match of String(text ?? "").matchAll(/\[([^\]]+)\]/g)) {
    for (const part of match[1].split(/[;,]/)) {
      const label = part.trim();
      if (label) labels.add(label);
    }
  }
  for (const match of String(text ?? "").matchAll(/\b(?:SO|Standing Order)\s+(\d+[A-Za-z]*)\b/g)) {
    labels.add(`SO ${match[1].toUpperCase()}`);
  }
  for (const match of String(text ?? "").matchAll(/\b(\d+\/\d+)\b/g)) labels.add(match[1]);
  return [...labels];
}

export function dropUnreferencedCitationEntries(answerText) {
  const sections = answerSections(answerText);
  const body = sections.filter((section) => section.heading !== "Best authorities to inspect or cite:").map((section) => section.lines.join("\n")).join("\n");
  const referenced = new Set(citationLabelsIn(body).map((label) => label.toLowerCase()));
  const dropped = [];
  const next = sections.map((section) => {
    if (section.heading !== "Best authorities to inspect or cite:") return section;
    const lines = section.lines.filter((line) => {
      const labels = citationLabelsIn(line);
      if (labels.length === 0) return true;
      const keep = labels.some((label) => referenced.has(label.toLowerCase()));
      if (!keep) dropped.push(...labels);
      return keep;
    });
    return { ...section, lines };
  });
  const text = next.flatMap((section) => section.heading ? [section.heading, ...section.lines] : section.lines).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text, dropped: [...new Set(dropped)] };
}

export function labelBareRulings(text) {
  return String(text ?? "").replace(/(^|[^\][A-Za-z0-9/])(\d+\/\d+)(?![A-Za-z0-9/])/g, (match, prefix, label, offset, whole) => {
    const before = whole.slice(Math.max(0, offset - 32), offset + prefix.length);
    if (/speakers?'?\s+rulings?|\bruling\b/i.test(before)) return match;
    return `${prefix}Speakers' ruling ${label}`;
  });
}

export function describesStandingOrdersAsStatute(text) {
  return /\bstanding orders?\b/i.test(text) && /\b(?:statute|enactment|act of parliament)\b/i.test(text);
}

export function overHedgesSettledDuty(answerText, sources) {
  const bodies = (sources ?? []).map((source) => source.sectionContent ?? "").filter(Boolean);
  if (bodies.length === 0) return false;
  const settled = bodies.every((body) => dutyVersusDiscretion(body) === "duty");
  const bottom = String(answerText ?? "").split("\n").slice(0, 6).join(" ");
  return settled && /\b(?:unclear|uncertain|it is not clear|might or might not)\b/i.test(bottom);
}

export function conditionalSubIssueGaps(answerText) {
  const bottom = answerSections(answerText).find((section) => section.heading === "Bottom line:");
  const prose = bottom ? bottom.lines.join(" ") : "";
  if (!/\bif\b/i.test(prose)) return [];
  const whole = String(answerText ?? "");
  const gaps = [];
  if (!/\b(?:decides|determines|decision-maker|presiding)\b/i.test(whole)) gaps.push("who_decides");
  if (!/\b(?:discretion|may|must)\b/i.test(whole)) gaps.push("discretion");
  if (!/\b(?:consequence|result|effect|then|otherwise)\b/i.test(whole)) gaps.push("consequence");
  return gaps;
}

export function actorClassDrift(claim, source) {
  const subject = (text) => {
    const match = String(text ?? "").match(/\b(?:the|a|an)\s+([a-z][a-z-]{3,})\s+(?:may|must|shall|cannot)\b/i);
    return match ? stem(match[1]) : "";
  };
  const claimActor = subject(claim);
  const sourceActor = subject(source);
  if (!claimActor || !sourceActor) return false;
  return claimActor !== sourceActor && !sharesPrefix(claimActor, sourceActor);
}

export function deriveDegraded(outcome) {
  return outcome.fallbackReason !== "none" || (outcome.partial?.length ?? 0) > 0 || outcome.abstained === true;
}

export function deriveAnswerOutcome(state) {
  const fallbackReason = FALLBACK_REASONS.includes(state.fallbackReason) ? state.fallbackReason : "none";
  const partial = [...new Set(state.partial ?? [])];
  const outcome = {
    route: state.route === "incident_adjudication" ? "incident_adjudication" : "semantic_selector",
    providerRetries: Math.max(0, Number(state.providerRetries) || 0),
    adjudicationRecovery: state.adjudicationRecovery === true,
    evidenceRecovery: state.evidenceRecovery === true,
    repairAttempted: state.repairAttempted === true,
    repairAccepted: state.repairAccepted === true,
    appealAttempted: state.appealAttempted === true,
    appealAccepted: state.appealAccepted === true,
    fallbackReason,
    partial,
    abstained: state.abstained === true,
    allObligationsComplete: state.allObligationsComplete !== false,
    obligationCoverage: Array.isArray(state.obligationCoverage) ? state.obligationCoverage.map(Number) : [],
  };
  return { ...outcome, degraded: deriveDegraded(outcome) };
}

export function freezeFirstDraft(draft) {
  const record = {
    answerText: String(draft?.answerText ?? ""),
    claimVerdicts: (draft?.claimVerdicts ?? []).map((verdict) => ({
      id: String(verdict.id ?? ""),
      supported: verdict.supported === true,
      reason: String(verdict.reason ?? ""),
    })),
    citations: [...new Set(draft?.citations ?? [])].map(String),
  };
  record.claimVerdicts.forEach((verdict) => Object.freeze(verdict));
  Object.freeze(record.claimVerdicts);
  Object.freeze(record.citations);
  return Object.freeze(record);
}

export function reasonFromProviderKind(kind) {
  if (kind === "rate_limited") return "provider_rate_limited";
  if (kind === "unavailable") return "provider_unavailable";
  if (kind === "upstream" || kind === "parse") return "provider_upstream";
  if (kind === "configuration") return "internal";
  return "internal";
}

export function learnSynonymsFromHeadings(headings) {
  const table = new Map();
  for (const heading of headings ?? []) {
    const match = String(heading).match(/^(.{2,60}?)\s+\((.{2,60})\)$/);
    if (!match) continue;
    const left = contentTokens(match[1]);
    const right = contentTokens(match[2]);
    if (left.length !== 1 || right.length !== 1) continue;
    table.set(left[0], right[0]);
    table.set(right[0], left[0]);
  }
  return table;
}

export function conceptsMatchingLabels(concepts, labels) {
  const wanted = new Set((labels ?? []).map((label) => String(label).toLowerCase().trim()).filter(Boolean));
  return (concepts ?? []).filter((concept) => {
    const names = [
      ...(concept.aliases ?? []),
      ...(concept.slots ?? []).flatMap((slot) => slot.headings ?? []),
    ].map((name) => String(name).toLowerCase());
    return names.some((name) => wanted.has(name));
  });
}

export const SEARCH_FOCUS_MAX_CHARS = 120;

export function isBoundedSearchFocus(value) {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > SEARCH_FOCUS_MAX_CHARS) return false;
  if (value !== value.trim() || value.includes("..") || value.includes("--")) return false;
  if (/[\u0000-\u001f<>]/.test(value)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9 .'/():_-]*$/.test(value);
}
