/**
 * Generic procedural mechanisms.
 * Retrieval- or relation-driven. No topic catalogues, authority sentences,
 * benchmark ids, or fixed admission scores.
 */

import {
  COMMITTEE_REFERENCE_WORDS,
  committeeRecords,
  committeeWords,
  foldCommitteeText,
  isCommitteeHeadingPrefix,
} from "./committee-names.js";
import { committeeClassWords } from "./committee-class-data.js";
import { foldPlural } from "./plural-fold.js";
import { corpusProceedingHeads, corpusProceedingPhrases } from "./corpus-proceedings-data.js";
import { corpusVocabulary } from "./corpus-vocabulary-data.js";
import { corpusFunctionWords, corpusReferentPhrases, corpusReferentWords } from "./corpus-referents-data.js";

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

/** Kind alone is not a route. Callers that adjudicate use adjudicationRouting, which also requires corroboration. */
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

function hasRelation(situation, name) {
  return Array.isArray(situation?.relations) && situation.relations.includes(name);
}

export function stageReopeningQueries(situation) {
  return hasRelation(situation, "stage_reopening") ? ["reopening a concluded stage"] : [];
}

export function proceedingConsequenceQueries(situation) {
  return hasRelation(situation, "proceeding_consequence") ? ["privilege and immunity of proceedings"] : [];
}

export function errorCorrectionQueries(situation) {
  return hasRelation(situation, "error_correction") ? ["correction of an erroneous recorded outcome"] : [];
}

export function presidingOfficerAppealQuery(situation) {
  return hasRelation(situation, "presiding_appeal") ? "appeal from a presiding officer" : null;
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

const ACT_SKIP = new Set([
  "a", "an", "the", "of", "to", "and", "in", "or", "on", "at", "for", "by", "as", "it",
  "that", "this", "from", "after", "before", "about", "under", "into", "their", "them",
  "who", "what", "when", "where", "which", "how", "not", "no", "with",
  "may", "must", "shall", "can", "will", "might", "could", "would", "should",
  "be", "am", "is", "are", "was", "were", "been", "being",
  "have", "has", "had", "having", "do", "does", "did", "doing",
]);

function hasVowel(word) {
  return /[aeiou]/.test(word);
}

/** Porter-style suffix stem. Exact equality only. Agentive -er/-or nouns are not reduced to the verb. */
export function suffixStem(word) {
  let value = String(word ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (value.length < 3) return value;
  if (/(?:er|or)s?$/.test(value) && value.length > 4) return value;
  if (value.endsWith("sses")) value = value.slice(0, -2);
  else if (value.endsWith("ies") && value.length > 4) value = `${value.slice(0, -3)}y`;
  else if (value.endsWith("ss")) { /* keep */ }
  else if (value.endsWith("s") && value.length > 3) value = value.slice(0, -1);
  if (value.endsWith("ing") && value.length > 5 && hasVowel(value.slice(0, -3))) {
    value = value.slice(0, -3);
    if (value.length > 3 && value.at(-1) === value.at(-2) && /[bcdfghjkmnpqrtvwx]/.test(value.at(-1))) {
      value = value.slice(0, -1);
    }
  } else if (value.endsWith("ed") && value.length > 4 && hasVowel(value.slice(0, -2))) {
    value = value.slice(0, -2);
    if (value.length > 3 && value.at(-1) === value.at(-2) && /[bcdfghjkmnpqrtvwx]/.test(value.at(-1))) {
      value = value.slice(0, -1);
    }
  }
  if (value.endsWith("ation") && value.length > 7) value = `${value.slice(0, -5)}e`;
  else if (value.endsWith("sion") && value.length > 6) value = `${value.slice(0, -4)}d`;
  else if (value.endsWith("tion") && value.length > 6) value = value.slice(0, -4);
  else if (value.endsWith("ment") && value.length > 6) value = value.slice(0, -4);
  return value.length >= 3 ? value : word;
}

function actLemmas(text) {
  const lemmas = [];
  for (const raw of String(text ?? "").toLowerCase().split(/[^a-z]+/)) {
    if (!raw || ACT_SKIP.has(raw)) continue;
    const stem = suffixStem(raw);
    if (!stem || stem.length < 3 || ACT_SKIP.has(stem)) continue;
    lemmas.push(stem);
  }
  return [...new Set(lemmas)];
}

function askedActParts(action, verb, objectText) {
  if (verb || objectText) return { verbs: actLemmas(verb || ""), objects: actLemmas(objectText || "") };
  const lemmas = actLemmas(action || "");
  return { verbs: lemmas.slice(0, 1), objects: lemmas.slice(1) };
}

/** Clean only when a verb lemma and an object lemma both occur. Anything weaker is unconfirmed. */
export function actAttestation(quote, action, verb, objectText) {
  if (!String(action || verb || objectText || "").trim()) return "clean";
  const asked = askedActParts(action, verb, objectText);
  if (asked.verbs.length === 0 || asked.objects.length === 0) return "unconfirmed";
  const present = new Set(actLemmas(quote));
  const verbOk = asked.verbs.some((lemma) => present.has(lemma));
  const objectOk = asked.objects.some((lemma) => present.has(lemma));
  return verbOk && objectOk ? "clean" : "unconfirmed";
}

export function quoteAttestsActAndObject(quote, action, verb, objectText) {
  return actAttestation(quote, action, verb, objectText) === "clean";
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

/**
 * Hand lists, each with one job:
 * - HEADING_PREFIX (in committee-names.js): words that introduce a body
 *   ("Functions of …"). Stripped before identity. A name that is only a prefix
 *   is unlisted, so a heading prefix is not mistaken for a body.
 * - Proceeding kinds are only the heads produced by the corpus generator.
 *   Number folding applies to those heads, and not to committee names.
 * - STRUCTURAL_WORD was removed. It ignored leftover leaf words such as
 *   "rules" and "procedure", and the three later additions introduction,
 *   procedures and provisions. That list decided which neutral leaves matched.
 *   A neutral leaf now matches without a word list.
 *
 * Forum identity. A match needs positive evidence. A reject needs a corpus-listed
 * committee. Every other conflict is uncertain.
 *
 * A committee name is generic only when every content word is a generated
 * class word or a reference word. Any other name is listed only when its
 * content-word multiset, with function words removed and without plural
 * folding, equals one record. Otherwise it is unlisted.
 *
 * Cross-kind conflict is judged on the leaf. A House or Chamber setting passes
 * when the leaf is House-level, even if an ancestor names a listed body.
 * An ancestor naming a different listed body rejects a committee setting only.
 *
 * Proceeding heads and phrases come from the generated corpus derivation.
 * Head-on-object applies only when the head is one of those nouns. The same
 * proceeding on the leaf matches; a different name or a conflicting ancestor
 * is uncertain.
 *
 * An unclassified setting matches its own leaf. An ancestor caps that match
 * only when it carries an identity: a listed body, a corpus proceeding, the
 * committee of the whole, a committee-shaped name, or a committee chapter or
 * part. Generic content words in an ancestor do not cap on their own.
 */
const CORPUS_PROCEEDING_HEADS = new Set(corpusProceedingHeads);
const CORPUS_PROCEEDING_PHRASES = corpusProceedingPhrases;

const NAME_STOP = new Set([
  "the", "a", "an", "in", "to", "by", "from", "with", "or", "at", "into", "when", "if", "as", "not",
  "under", "after", "before", "during", "per", "than", "its", "their",
]);
const FUNCTION_WORD = new Set([
  "the", "a", "an", "on", "of", "for", "and", "this", "any", "every", "each", "that", "these", "those",
]);
const REFERENCE_WORD = new Set(COMMITTEE_REFERENCE_WORDS);
const PROCEEDING_STOP = new Set([
  "the", "a", "an", "of", "to", "for", "on", "in", "and", "by", "from", "at", "or",
]);

function sameTokens(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length > 0
    && left.length === right.length
    && left.every((token, index) => token === right[index]);
}

function forumWords(text) {
  return committeeWords(text).filter((word) => word !== "s");
}

function pluralFold(word) {
  return foldPlural(word);
}

const CORPUS_VOCABULARY = new Set(corpusVocabulary);
const REFERENT_WORDS = new Set(corpusReferentWords);
const REFERENT_PHRASES = new Set(corpusReferentPhrases);
const GENERATED_FUNCTION = new Set(corpusFunctionWords);

function isCorpusWord(word) {
  return CORPUS_VOCABULARY.has(word)
    || CORPUS_VOCABULARY.has(pluralFold(word))
    || CORPUS_VOCABULARY.has(`${word}s`)
    || CORPUS_VOCABULARY.has(`${word}es`);
}

function isNameWord(word) {
  return !isCorpusWord(word);
}

function foldedWords(text) {
  return forumWords(text).map(pluralFold);
}

function hasWord(text, word) {
  const words = forumWords(text);
  return words.includes(word) || (word === "committee" && words.includes("committees"));
}

function isCotwhText(text) {
  return hasWord(text, "committee") && forumWords(text).includes("whole");
}

function surfaceCommitteeTokens(text) {
  const words = forumWords(text);
  const tokens = [];
  for (let index = 0; index < words.length; index += 1) {
    if (words[index] !== "committee" && words[index] !== "committees") continue;
    const left = [];
    for (let prior = index - 1; prior >= 0; prior -= 1) {
      const word = words[prior];
      if (word === "committee" || word === "committees") break;
      if (word === "and" || word === "of" || word === "on" || word === "for") continue;
      if (nameScanStops(word)) break;
      left.unshift(word);
    }
    const right = [];
    if (["on", "of", "for"].includes(words[index + 1] ?? "")) {
      let next = index + 2;
      while (["the", "a", "an"].includes(words[next] ?? "")) next += 1;
      while (words[next] && words[next] !== "committee" && words[next] !== "committees") {
        const word = words[next];
        if (word === "and") { next += 1; continue; }
        if (nameScanStops(word)) break;
        right.push(word);
        next += 1;
      }
    }
    tokens.push(...left, ...right);
  }
  const unique = [...new Set(tokens)];
  while (unique.length > 0 && isCommitteeHeadingPrefix(unique[0])) unique.shift();
  return unique;
}

function isProceedingKindWord(word) {
  return CORPUS_PROCEEDING_HEADS.has(pluralFold(word));
}

function listedNameTokens() {
  const tokens = new Set();
  for (const record of committeeRecords()) {
    for (const token of record?.tokens ?? []) tokens.add(token);
  }
  return tokens;
}

function nameScanStops(word) {
  if (listedNameTokens().has(word) || REFERENCE_WORD.has(word)) return false;
  return GENERATED_FUNCTION.has(word);
}

function collectedNameWords(text) {
  const words = committeeWords(text);
  const tokens = [];
  for (let index = 0; index < words.length; index += 1) {
    if (words[index] !== "committee" && words[index] !== "committees") continue;
    const left = [];
    for (let prior = index - 1; prior >= 0; prior -= 1) {
      const word = words[prior];
      if (word === "committee" || word === "committees") break;
      if (FUNCTION_WORD.has(word)) continue;
      if (nameScanStops(word)) break;
      if (isProceedingKindWord(word) && left.length > 0) break;
      left.unshift(word);
    }
    const right = [];
    if (["on", "of", "for"].includes(words[index + 1] ?? "")) {
      let next = index + 2;
      while (FUNCTION_WORD.has(words[next] ?? "")) next += 1;
      while (words[next] && words[next] !== "committee" && words[next] !== "committees") {
        const word = words[next];
        if (FUNCTION_WORD.has(word)) { next += 1; continue; }
        if (nameScanStops(word)) break;
        right.push(word);
        next += 1;
      }
    }
    tokens.push(...left, ...right);
  }
  return tokens;
}

function nameContentMultiset(text) {
  const tokens = collectedNameWords(text);
  while (tokens.length > 0 && isCommitteeHeadingPrefix(tokens[0])) tokens.shift();
  return tokens.slice().sort();
}

function nameHead(text) {
  const words = committeeWords(text);
  let head = "";
  for (const word of words) {
    if (word === "committee" || word === "committees") head = word;
  }
  return head;
}

function sameMultiset(left, right) {
  return sameTokens(left, right);
}

function recordNameText(record) {
  const segments = Array.isArray(record?.path) && record.path.length > 0 ? record.path : [];
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (!hasWord(segments[index], "committee")) continue;
    if (nameContentMultiset(segments[index]).length > 0) return segments[index];
  }
  return String(record?.citationLabel ?? "");
}

function recordContent(record) {
  return nameContentMultiset(recordNameText(record));
}

function recordHead(record) {
  return nameHead(recordNameText(record));
}

function activeClassWords() {
  const used = new Set();
  for (const record of committeeRecords()) {
    for (const token of recordContent(record)) used.add(token);
  }
  return committeeClassWords.filter((word) => !used.has(word));
}

function isGenericCommitteeName(text) {
  if (!hasWord(text, "committee") || isCotwhText(text)) return false;
  const collected = collectedNameWords(text);
  const content = nameContentMultiset(text);
  if (content.length === 0) return collected.length === 0;
  const classes = new Set(activeClassWords());
  return content.every((word) => classes.has(word) || REFERENCE_WORD.has(word));
}

function listedRecord(text) {
  if (isGenericCommitteeName(text)) return null;
  const tokens = nameContentMultiset(text);
  if (tokens.length === 0) return null;
  const head = nameHead(text);
  const hits = committeeRecords().filter((record) => sameMultiset(recordContent(record), tokens) && recordHead(record) === head);
  return hits.length === 1 ? hits[0] : null;
}

function isHouseInCommittee(text) {
  return hasWord(text, "house") && hasWord(text, "committee") && !isCotwhText(text) && !listedRecord(text);
}

function bareInCommittee(text) {
  return /\bin committees?\b/.test(foldCommitteeText(text)) && !hasWord(text, "house") && !isCotwhText(text);
}

function isHouseLevel(text) {
  return (hasWord(text, "house") || hasWord(text, "chamber")) && !hasWord(text, "committee") && !isCotwhText(text);
}

function containsContiguous(haystack, needle) {
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((word, index) => haystack[start + index] === word)) return true;
  }
  return false;
}

function phrasesIn(text) {
  const folded = foldedWords(text);
  return CORPUS_PROCEEDING_PHRASES.filter((phrase) => containsContiguous(folded, phrase));
}

function corpusHead(text) {
  const words = forumWords(text);
  const link = words.findIndex((word) => word === "on" || word === "of" || word === "for");
  if (link > 0 && CORPUS_PROCEEDING_HEADS.has(pluralFold(words[link - 1]))) return pluralFold(words[link - 1]);
  const heads = foldedWords(text).filter((word) => CORPUS_PROCEEDING_HEADS.has(word));
  return heads.length > 0 ? heads[heads.length - 1] : null;
}

function syntheticHead(text) {
  if (corpusHead(text) || isCotwhText(text) || (isHouseLevel(text) && !corpusHead(text))) return null;
  const words = forumWords(text);
  if (hasWord(text, "committee")) {
    const index = words.findIndex((word) => word === "committee" || word === "committees");
    if (["on", "of", "for"].includes(words[index + 1] ?? "")) return null;
    const after = words.slice(index + 1).filter((word) => !PROCEEDING_STOP.has(word));
    const afterHead = after.length > 0 ? after[after.length - 1] : "";
    if (!afterHead || isNameWord(afterHead)) return null;
    return pluralFold(afterHead);
  }
  const content = words.filter((word) => !PROCEEDING_STOP.has(word));
  if (content.length === 0) return null;
  const head = content[content.length - 1];
  if (head === "house" || head === "chamber" || head === "whole" || isNameWord(head)) return null;
  return pluralFold(head);
}

function proceedingHead(text) {
  return corpusHead(text) || syntheticHead(text);
}

function nameWords(text, head) {
  const committeeName = new Set(surfaceCommitteeTokens(text).map(pluralFold));
  return foldedWords(text).filter((word) => {
    if (word === head || PROCEEDING_STOP.has(word) || CORPUS_PROCEEDING_HEADS.has(word) || committeeName.has(word)) return false;
    if (committeeName.size > 0 && (word === "committee" || word === "committees")) return false;
    return true;
  });
}

function proceedingRelation(setting, other) {
  const settingPhrases = phrasesIn(setting);
  const otherPhrases = phrasesIn(other);
  if (settingPhrases.length > 0 && otherPhrases.some((phrase) => settingPhrases.some((item) => sameTokens(item, phrase)))) {
    return "same";
  }
  if (settingPhrases.length > 0 && otherPhrases.length > 0) return "different";
  if (settingPhrases.length === 0 && otherPhrases.length > 0) return "different";
  const head = proceedingHead(setting);
  if (!head) return "none";
  const otherHead = corpusHead(other);
  if (otherHead && otherHead !== head) return "different";
  const otherWords = foldedWords(other);
  if (!otherWords.includes(head) && phrasesIn(other).length === 0) return "none";
  if (!otherWords.includes(head)) return "different";
  const names = nameWords(setting, head);
  const present = new Set(otherWords);
  if (names.every((word) => present.has(word))) return "same";
  return "different";
}

function ancestorProceedingConflict(setting, segment) {
  if (inGeneral(segment)) return false;
  // A Committee of the whole part is a narrower forum than a headed proceeding.
  if (isCotwhText(segment)) return true;
  // A corpus phrase that is a different proceeding, or a narrower specific of this head.
  if (phrasesIn(segment).length > 0 && proceedingRelation(setting, segment) === "different") return true;
  const head = proceedingHead(setting);
  if (!head || !isProceedingKindWord(head) || !foldedWords(segment).includes(head)) return false;
  const vocabulary = new Set(CORPUS_PROCEEDING_PHRASES.flat());
  const extras = (text) => nameWords(text, head).filter((word) => !vocabulary.has(word));
  const left = extras(setting);
  const right = extras(segment);
  if (left.length === 0 || right.length === 0) return false;
  return left.some((word) => !right.includes(word));
}

function inGeneral(text) {
  return /\bin general\b/.test(foldCommitteeText(text));
}

function listedIn(segments) {
  const found = [];
  for (const segment of segments) {
    const record = listedRecord(segment);
    if (record && !found.some((item) => sameTokens(item.tokens, record.tokens))) found.push(record);
  }
  return found;
}

function ancestorHasCommittee(segments) {
  return segments.some((segment) => hasWord(segment, "committee"));
}

function pathHasCotwh(segments) {
  return segments.some((segment) => isCotwhText(segment));
}

function houseResult(setting, segments) {
  const leaf = segments.length > 0 ? segments[segments.length - 1] : "";
  const ancestors = segments.slice(0, -1);
  if (isCotwhText(leaf) || isHouseInCommittee(leaf) || bareInCommittee(leaf) || hasWord(leaf, "committee")) {
    if (phrasesIn(setting).length > 0 && listedRecord(leaf)) return "reject";
    return "uncertain";
  }
  if (pathHasCotwh(segments)) return "uncertain";
  if (isHouseLevel(leaf)) return "match";
  const head = corpusHead(leaf);
  if (head) return listedIn(ancestors).length > 0 ? "uncertain" : "match";
  if (ancestorHasCommittee(ancestors)) return "uncertain";
  return "match";
}

function cotwhResult(setting, segments) {
  const leaf = segments.length > 0 ? segments[segments.length - 1] : "";
  const asked = listedRecord(setting);
  const bodies = listedIn(segments);
  const different = bodies.filter((record) => !asked || !sameTokens(record.tokens, asked.tokens));
  const same = asked && bodies.some((record) => sameTokens(record.tokens, asked.tokens));
  if (pathHasCotwh(segments) && different.length === 0 && !isHouseLevel(leaf)) return "match";
  if (different.length > 0 && !same) return "reject";
  if (isCotwhText(leaf)) return "match";
  if (isHouseLevel(leaf)) return "uncertain";
  return "uncertain";
}

function committeeKind(setting) {
  if (!hasWord(setting, "committee") || isCotwhText(setting)) return null;
  if (listedRecord(setting)) return "listed";
  if (isGenericCommitteeName(setting)) return "generic";
  return "unlisted";
}

function committeeResult(setting, segments) {
  const leaf = segments.length > 0 ? segments[segments.length - 1] : "";
  const kind = committeeKind(setting);
  if (!kind) return "match";
  const asked = listedRecord(setting);
  const bodies = listedIn(segments);
  const different = bodies.filter((record) => !asked || !sameTokens(record.tokens, asked.tokens));
  const same = Boolean(asked && bodies.some((record) => sameTokens(record.tokens, asked.tokens)));
  if (kind === "listed") {
    if (same && different.length > 0) return "uncertain";
    if (different.length > 0) return "reject";
    if ((isCotwhText(leaf) || isHouseInCommittee(leaf)) && !same) return "reject";
    if (same && isHouseLevel(leaf) && !listedRecord(leaf)) return "uncertain";
    if (same) return "match";
    if (committeeKind(leaf) === "generic") {
      const head = corpusHead(leaf);
      if (!head || forumWords(setting).includes(head)) return "match";
      return "uncertain";
    }
    if (isHouseLevel(leaf) || hasWord(leaf, "house") || hasWord(leaf, "chamber") || ancestorHasCommittee(segments.slice(0, -1))) {
      return "uncertain";
    }
    if (nameHead(setting) === nameHead(leaf) && sameTokens(surfaceCommitteeTokens(setting), surfaceCommitteeTokens(leaf))) return "match";
    return "uncertain";
  }
  if (kind === "generic") {
    if (isCotwhText(leaf) || isHouseInCommittee(leaf) || isHouseLevel(leaf)) return "uncertain";
    if (segments.some((segment) => isHouseLevel(segment)) && !listedRecord(leaf)) return "uncertain";
    // A generic name matches a leaf whose committee mention is generic.
    // Descriptive words around that mention do not make a specific body.
    if (committeeMentionIsSpecific(leaf)) return "uncertain";
    const classes = new Set(activeClassWords());
    const other = classlessWords(setting).filter((word) => word !== "committee" && word !== "committees"
      && !classes.has(word) && !REFERENCE_WORD.has(word));
    if (other.length > 0 && !sameTokens(classlessWords(setting), classlessWords(leaf))
      && other.some((word) => classlessWords(leaf).some((item) => item === word || prefixOverlap(word, item)))) {
      return "uncertain";
    }
    if (hasWord(leaf, "committee")) return "match";
    if (isNeutralLeaf(leaf) && segments.slice(0, -1).some((segment) => specificBodyText(segment) || isCotwhText(segment))) return "uncertain";
    return "match";
  }
  if (nameHead(setting) === nameHead(leaf) && sameTokens(surfaceCommitteeTokens(setting), surfaceCommitteeTokens(leaf))) return "match";
  if (committeeKind(leaf) === "generic") return "match";
  return "uncertain";
}

function proceedingResult(setting, segments) {
  if (!proceedingHead(setting)) return "match";
  if (segments.some((segment) => inGeneral(segment))) return "match";
  const leaf = segments.length > 0 ? segments[segments.length - 1] : "";
  const ancestors = segments.slice(0, -1);
  if (ancestors.some((segment) => {
    const record = listedRecord(segment);
    const asked = listedRecord(setting);
    if (record && (!asked || !sameMultiset(recordContent(record), recordContent(asked)))) return true;
    if (bareNameHeading(segment) && !ancestorNamesOwnName(setting, segment)) return true;
    return ancestorProceedingConflict(setting, segment);
  })) return "uncertain";
  return proceedingRelation(setting, leaf) === "same" ? "match" : "uncertain";
}

function committeeMentionIsSpecific(text) {
  if (!hasWord(text, "committee") || isCotwhText(text) || isHouseInCommittee(text)) return false;
  if (listedRecord(text)) return true;
  const words = forumWords(text);
  const classes = new Set(activeClassWords());
  for (let index = 0; index < words.length; index += 1) {
    if (words[index] !== "committee" && words[index] !== "committees") continue;
    const plural = words[index] === "committees";
    const stops = (word) => GENERATED_FUNCTION.has(word) && !classes.has(word) && !REFERENCE_WORD.has(word);
    const left = [];
    for (let prior = index - 1; prior >= 0; prior -= 1) {
      const word = words[prior];
      if (word === "committee" || word === "committees") break;
      if (classes.has(word) || REFERENCE_WORD.has(word)) {
        left.unshift(word);
        continue;
      }
      if (stops(word)) break;
      left.unshift(word);
    }
    if (left.length > 0 && (classes.has(left[left.length - 1]) || REFERENCE_WORD.has(left[left.length - 1]))) {
      const run = [];
      for (let cursor = left.length - 1; cursor >= 0; cursor -= 1) {
        const word = left[cursor];
        if (!(classes.has(word) || REFERENCE_WORD.has(word))) break;
        run.unshift(word);
      }
      left.length = 0;
      left.push(...run);
    }
    while (left.length > 0 && isCommitteeHeadingPrefix(left[0])) left.shift();
    const content = left.filter((word) => !classes.has(word) && !REFERENCE_WORD.has(word) && !FUNCTION_WORD.has(word));
    if (!plural && ["on", "of", "for"].includes(words[index + 1] ?? "")) {
      for (let after = index + 2; after < words.length; after += 1) {
        const word = words[after];
        if (FUNCTION_WORD.has(word)) continue;
        if (word === "committee" || word === "committees") break;
        if (!classes.has(word) && !REFERENCE_WORD.has(word)) content.push(word);
      }
    }
    if (content.length > 0) return true;
  }
  return false;
}

function classlessWords(text) {
  return forumWords(text).filter((word) => !FUNCTION_WORD.has(word));
}

function bareNameHeading(segment) {
  if (isHouseLevel(segment) || isCotwhText(segment) || hasWord(segment, "committee") || inGeneral(segment)) return false;
  if (phrasesIn(segment).length > 0 || corpusHead(segment)) return false;
  const words = forumWords(segment).filter((word) => !FUNCTION_WORD.has(word));
  return words.length > 0 && words.every((word) => isNameWord(word));
}

function prefixOverlap(left, right) {
  if (left === right) return false;
  const short = left.length <= right.length ? left : right;
  const long = left.length <= right.length ? right : left;
  return short.length >= 4 && long.startsWith(short);
}

function headingParts(segment) {
  // "and" and "or" split only as whole words. "&" and commas split anywhere.
  const parts = String(segment).split(/\s*(?:,|&|\band\b|\bor\b)\s*/i).map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [String(segment)];
}

function keptContent(text) {
  const words = forumWords(text);
  const phraseIndex = new Set();
  for (const phrase of REFERENT_PHRASES) {
    const parts = phrase.split(" ");
    for (let start = 0; start + parts.length <= words.length; start += 1) {
      if (parts.every((part, offset) => words[start + offset] === part)) {
        parts.forEach((_, offset) => phraseIndex.add(start + offset));
      }
    }
  }
  return words.filter((word, index) => {
    if (word === "committee" || word === "committees" || REFERENT_WORDS.has(word) || phraseIndex.has(index)) return true;
    return !FUNCTION_WORD.has(word) && !GENERATED_FUNCTION.has(word);
  });
}

function partContainsNames(part, names) {
  const present = new Set(forumWords(part));
  return names.every((word) => present.has(word));
}

function referentPhraseAdded(setting, part) {
  const settingWords = new Set(forumWords(setting));
  const words = forumWords(part);
  for (const phrase of REFERENT_PHRASES) {
    const tokens = phrase.split(" ");
    for (let start = 0; start + tokens.length <= words.length; start += 1) {
      if (!tokens.every((token, offset) => words[start + offset] === token)) continue;
      if (tokens.every((token) => settingWords.has(token))) continue;
      return true;
    }
  }
  return false;
}

function ruling4(setting, part) {
  const left = keptContent(setting);
  const right = keptContent(part);
  if (sameTokens(left, right)) return "match";
  const extra = right.filter((word) => !left.includes(word));
  if (extra.some((word) => isNameWord(word) || REFERENT_WORDS.has(word) || word === "committee" || word === "committees")) {
    return "uncertain";
  }
  if (referentPhraseAdded(setting, part)) return "uncertain";
  return "match";
}

function ruling3(setting, segment) {
  const left = classlessWords(setting);
  const right = classlessWords(segment);
  if (sameTokens(left, right)) return false;
  return left.some((word) => right.some((other) => word === other || prefixOverlap(word, other)));
}

function leafIsSpecific(leaf) {
  if (isHouseLevel(leaf) || isCotwhText(leaf) || isHouseInCommittee(leaf)) return true;
  if (hasWord(leaf, "committee") || listedRecord(leaf)) return true;
  if (phrasesIn(leaf).length > 0 || corpusHead(leaf)) return true;
  if (forumWords(leaf).some((word) => REFERENT_WORDS.has(word))) return true;
  const phrase = forumWords(leaf).filter((word) => !["the", "a", "an"].includes(word)).join(" ");
  return REFERENT_PHRASES.has(phrase);
}

function ancestorNamesOwnName(setting, segment) {
  const names = classlessWords(setting).filter((word) => isNameWord(word));
  if (names.length === 0) return false;
  const present = new Set(forumWords(segment));
  return names.every((word) => present.has(word));
}

function ancestorNamesSetting(setting, segment) {
  const words = forumWords(setting).filter((word) => !FUNCTION_WORD.has(word));
  if (words.length === 0) return false;
  const present = new Set(forumWords(segment));
  return words.every((word) => present.has(word));
}

function specificBodyText(text) {
  return Boolean(listedRecord(text)) || (hasWord(text, "committee") && !isGenericCommitteeName(text) && !isCotwhText(text) && !isHouseInCommittee(text));
}

function isNeutralLeaf(leaf) {
  if (isHouseLevel(leaf) || isCotwhText(leaf) || isHouseInCommittee(leaf)) return false;
  if (specificBodyText(leaf)) return false;
  if (phrasesIn(leaf).length > 0 || corpusHead(leaf)) return false;
  return true;
}

function classlessIdentityConflict(setting, segment) {
  if (isHouseLevel(segment) || inGeneral(segment)) return false;
  if (ancestorNamesSetting(setting, segment)) return false;
  if (listedRecord(segment) || isCotwhText(segment) || hasWord(segment, "committee")) return true;
  return phrasesIn(segment).length > 0;
}

function distinguishingTokens(setting) {
  const names = classlessWords(setting).filter((word) => isNameWord(word));
  return names.length > 0 ? names : classlessWords(setting);
}

function leafEqualsClassless(setting, leaf) {
  return sameTokens(keptContent(setting), keptContent(leaf))
    || sameTokens(classlessWords(setting), classlessWords(leaf));
}

function classlessResult(setting, segments) {
  const leaf = segments.length > 0 ? segments[segments.length - 1] : "";
  const names = classlessWords(setting).filter((word) => isNameWord(word));
  const tokens = distinguishingTokens(setting);
  const leafEqual = leafEqualsClassless(setting, leaf);
  if (names.length > 0 && !segments.some((segment) => headingParts(segment).some((part) => partContainsNames(part, names)))) {
    return "uncertain";
  }
  for (const segment of segments) {
    for (const part of headingParts(segment)) {
      if (!partContainsNames(part, tokens)) continue;
      if (ruling4(setting, part) === "uncertain") return "uncertain";
    }
  }
  if (leafEqual) return "match";
  const namedLeafParts = headingParts(leaf).filter((part) => partContainsNames(part, tokens));
  for (const segment of segments) {
    if (headingParts(segment).some((part) => partContainsNames(part, tokens))) continue;
    if (ruling3(setting, segment)) return "uncertain";
  }
  if (namedLeafParts.length === 0 && classlessWords(leaf).some((word) => isNameWord(word) && !classlessWords(setting).includes(word))) {
    return "uncertain";
  }
  if (namedLeafParts.length === 0 && leafIsSpecific(leaf)) return "uncertain";
  const leafHead = corpusHead(leaf);
  if (leafHead && !forumWords(setting).includes(leafHead) && !foldedWords(setting).includes(leafHead)) return "uncertain";
  return "match";
}

function combineOutcomes(results) {
  if (results.includes("reject")) return "reject";
  if (results.includes("uncertain")) return "uncertain";
  return "match";
}

export function forumIdentityOutcome(setting, path) {
  const segments = Array.isArray(path) ? path : String(path ?? "").trim() ? [String(path)] : [];
  if (forumWords(setting).length === 0) return "match";
  if (bareInCommittee(setting) && !listedRecord(setting) && !isCotwhText(setting)) return "uncertain";
  const results = [];
  if ((hasWord(setting, "house") || hasWord(setting, "chamber")) && !isCotwhText(setting)) {
    results.push(houseResult(setting, segments));
  }
  if (isCotwhText(setting)) results.push(cotwhResult(setting, segments));
  if (hasWord(setting, "committee") && !isCotwhText(setting) && !bareInCommittee(setting)) {
    results.push(committeeResult(setting, segments));
  }
  const generatedHead = corpusHead(setting);
  const classless = !generatedHead && committeeKind(setting) === null && !isCotwhText(setting)
    && !hasWord(setting, "house") && !hasWord(setting, "chamber");
  if (classless && segments.slice(0, -1).some((segment) => classlessIdentityConflict(setting, segment))) {
    results.push("uncertain");
  }
  if (classless) results.push(classlessResult(setting, segments));
  if (generatedHead) results.push(proceedingResult(setting, segments));
  if (results.length === 0) return classlessResult(setting, segments);
  return combineOutcomes(results);
}

export function tallyForumOutcomes(records, setting) {
  const seen = new Set();
  let identity = 0;
  let ambiguous = 0;
  for (const record of records ?? []) {
    const id = String(record?.sectionId || record?.citationLabel || "");
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const path = Array.isArray(record?.path) && record.path.length > 0
      ? record.path
      : [record?.heading].filter(Boolean);
    const outcome = forumIdentityOutcome(String(setting ?? ""), path);
    if (outcome === "reject") identity += 1;
    else if (outcome === "uncertain") ambiguous += 1;
  }
  return { identity, ambiguous };
}

export function forumIdentityMismatch(setting, path) {
  return forumIdentityOutcome(setting, path) === "reject" ? "forum-identity" : null;
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
  return /^(?:scope-not-established|forum-identity|procedure-homonym)/.test(String(reason ?? ""));
}

const BLOCKING_REASON = new Set([
  "unverified-verbatim-witness",
  "ambiguous-source-identity",
  "invalid-source-role",
]);

export function rejectionKeysFor(record) {
  const keys = [];
  if (record?.sectionId) keys.push(`id:${record.sectionId}`);
  const corpus = String(record?.documentCorpus || record?.corpus || "");
  const label = String(record?.citationLabel || "").trim().toLowerCase();
  if (label) keys.push(`label:${corpus}:${label}`);
  return keys;
}

export function dispositionBlocksRecovery(row) {
  if (!row) return false;
  if (row.status && row.status !== "admitted") return true;
  return BLOCKING_REASON.has(row.reason) || isApplicabilityRejection(row.reason);
}

export function collectRejectionKeys(input) {
  const keys = new Set();
  const add = (row) => { for (const key of rejectionKeysFor(row)) keys.add(key); };
  for (const row of input?.dispositions ?? []) if (dispositionBlocksRecovery(row)) add(row);
  for (const row of input?.recoveryDispositions ?? []) if (dispositionBlocksRecovery(row)) add(row);
  for (const row of input?.selectorRejections ?? []) add(row);
  return keys;
}

export function recoverySuppressed(diagnostic) {
  const status = String(diagnostic?.status ?? "");
  if (status === "v40_no_governing_witness") return true;
  if (status === "no_retrieved_source_bodies") return true;
  if (status.startsWith("adjudication_unavailable")) return true;
  if (diagnostic?.recovery?.status === "provider_unavailable") return true;
  return false;
}

export function isRejectedCandidate(candidate, rejectedKeys) {
  return rejectionKeysFor(candidate).some((key) => rejectedKeys.has(key));
}

/** Overlooked candidates still have to attest the act. A cross-reference does not waive that. */
export function selectOverlookedCandidates(input) {
  const admitted = new Set(input.admittedIds ?? []);
  const seen = new Set();
  const selected = [];
  for (const candidate of input.pool ?? []) {
    if (!candidate?.sectionId || admitted.has(candidate.sectionId) || seen.has(candidate.sectionId)) continue;
    if (isRejectedCandidate(candidate, input.rejectedKeys)) continue;
    if ((input.action || input.verb || input.objectText) && !quoteAttestsActAndObject(candidate.sectionContent || "", input.action, input.verb, input.objectText)) continue;
    seen.add(candidate.sectionId);
    selected.push(candidate);
  }
  return selected;
}

export function filterDraftNamedAuthorities(named, admitted) {
  const allowed = new Set((admitted ?? []).map((authority) => String(authority.citationLabel || "").toLowerCase()));
  return (named ?? []).filter((authority) => allowed.has(String(authority.citationLabel || "").toLowerCase()));
}

/** Match known authority labels inside citation brackets. Do not split on comma or semicolon. */
export function authoritiesReferencedByAnswer(answerText, authorities) {
  const pack = authorities ?? [];
  if (pack.length === 0) return [];
  const brackets = [...String(answerText ?? "").matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
  const matched = pack.filter((authority) => {
    const label = String(authority.citationLabel || "").trim();
    if (!label) return false;
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, "i");
    return brackets.some((bracket) => pattern.test(bracket));
  });
  return matched.length > 0 ? matched : pack;
}

/** Answer-route rule: a successful answer draft, otherwise the last model whose attempt started. */
export function resolveServedModel(answerModel, lastAttemptedModel) {
  return answerModel ?? lastAttemptedModel ?? null;
}

export function negativePowerWitnessScore(input) {
  const source = String(input?.source ?? "").toLowerCase();
  const actorTokens = contentTokens(input?.actor ?? "");
  const actTokens = contentTokens(input?.act ?? "");
  if (!source || actorTokens.length === 0 || actTokens.length === 0) return 0;
  const sourceTokens = contentTokens(source);
  const actorHit = actorTokens.some((token) => sourceTokens.some((item) => item === token || sharesPrefix(item, token)));
  const lacks = /\b(?:cannot|may not|must not|shall not|has no power|no power|not entitled)\b/i.test(source);
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

const UNCERTAINTY_CLASSES = new Set([
  "coverage_gap",
  "retrieval_uncertainty",
  "interpretive_uncertainty",
  "authority_conflict",
  "higher_law_tension",
  "facts_incomplete",
]);
const SETTLEMENT_RANK = { supported: 1, partial: 2, not_answered: 3 };

function trailerPlain(line) {
  return String(line ?? "").trim()
    .replace(/^>\s*/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/[*`]+/g, "")
    .replace(/(^|\s)_([^_\n]+)_(\s|$)/g, "$1$2$3")
    .trim();
}

function settlementValue(raw) {
  const value = String(raw ?? "").toLowerCase();
  if (value === "supported" || value === "settled") return "supported";
  if (value === "partial" || value === "partly_settled") return "partial";
  if (value === "not_answered" || value === "insufficient") return "not_answered";
  return null;
}

// WD-0000 R7 interim test method: apparent silence is retrieval uncertainty until a
// coverage statement declares a source class that is not held. This batch has no
// coverage statement, so corpus_silence and coverage_gap both map to retrieval_uncertainty.
function uncertaintyClass(raw) {
  const value = String(raw ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (value === "corpus_silence" || value === "coverage_gap") return "retrieval_uncertainty";
  return UNCERTAINTY_CLASSES.has(value) ? value : null;
}

function uncertaintyFacet(raw) {
  const facet = String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 _:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48)
    .trim();
  if (facet.length < 2 || facet.split(" ").length > 6) return null;
  if (/\b(?:verified|validated|authoritative|official|exhaustive|complete)\b/.test(facet)) return null;
  if (!/^[a-z0-9][a-z0-9 _:-]*$/.test(facet)) return null;
  return facet;
}

/** Trailer only. A missing line stays null so it cannot be read as supported. */
export function parseSettlement(answerText) {
  const lines = String(answerText ?? "").split("\n");
  const nonEmpty = [];
  lines.forEach((line, index) => { if (line.trim()) nonEmpty.push(index); });
  const trailer = new Set(nonEmpty.slice(-6));
  let settlement = null;
  const uncertainty = [];
  const kept = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!trailer.has(index)) { kept.push(lines[index]); continue; }
    const plain = trailerPlain(lines[index]);
    if (/^Settlement:/i.test(plain)) {
      const settled = plain.match(/^Settlement:\s*(supported|partial|not_answered|settled|partly_settled|insufficient)\s*$/i);
      const value = settled ? settlementValue(settled[1]) : null;
      if (value && (SETTLEMENT_RANK[value] ?? 0) > (SETTLEMENT_RANK[settlement] ?? 0)) settlement = value;
      continue;
    }
    const open = plain.match(/^Unresolved:\s*(.*)$/i);
    if (open) {
      const parts = open[1].split(";").map((part) => part.trim()).filter(Boolean);
      const parsed = [];
      let grammar = parts.length > 0;
      for (const item of parts) {
        const match = item.match(/^(coverage_gap|retrieval_uncertainty|interpretive_uncertainty|authority_conflict|higher_law_tension|facts_incomplete|corpus_silence)\s*[:\s]\s*(.+)$/i);
        const uncertaintyClassName = match ? uncertaintyClass(match[1]) : null;
        const facet = match ? uncertaintyFacet(match[2]) : null;
        if (!uncertaintyClassName || !facet) { grammar = false; continue; }
        parsed.push({ class: uncertaintyClassName, facet });
      }
      for (const row of parsed) {
        if (uncertainty.length >= 6) break;
        if (uncertainty.some((item) => item.class === row.class && item.facet === row.facet)) continue;
        uncertainty.push(row);
      }
      if (grammar) continue;
    }
    kept.push(lines[index]);
  }
  return { text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(), settlement, uncertainty };
}

const OPERATOR_WORD = /(?:subject to|except as provided in|despite|notwithstanding|in accordance with|within the meaning of|as defined in)/gi;

function readOperatorTarget(rest) {
  const text = String(rest ?? "").replace(/^\s*(?:the\s+)?/i, "");
  let match = /^(?:standing orders?|so)\s+(\d+[a-z]*)\b/i.exec(text);
  if (match) return { kind: "standing_order", key: `SO ${match[1].toUpperCase()}` };
  match = /^(\d+)\s*\/\s*(\d+)\b/.exec(text);
  if (match) return { kind: "ruling", key: `${match[1]}/${match[2]}` };
  match = /^appendix\s+([a-z])\s+(?:clause|cl\.?)\s+(\d+[a-z]*)\b/i.exec(text);
  if (match) return { kind: "clause", key: `APPENDIX ${match[1].toUpperCase()} CL ${match[2].toUpperCase()}` };
  match = /^(?:clause|cl\.?)\s+(\d+[a-z]*)(?:\s+of\s+appendix\s+([a-z]))?\b/i.exec(text);
  if (match) {
    const key = match[2]
      ? `APPENDIX ${match[2].toUpperCase()} CL ${match[1].toUpperCase()}`
      : `CLAUSE ${match[1].toUpperCase()}`;
    return { kind: "clause", key };
  }
  return null;
}

export function canonicalCitationLabel(label) {
  const text = String(label ?? "").trim();
  const standing = text.match(/^(?:standing orders?|so)\s*(\d+[a-z]*)$/i);
  if (standing) return `SO ${standing[1].toUpperCase()}`;
  const ratio = text.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (ratio) return `${ratio[1]}/${ratio[2]}`;
  const appendix = text.match(/^appendix\s+([a-z])\s+(?:clause|cl\.?)\s*(\d+[a-z]*)$/i);
  if (appendix) return `APPENDIX ${appendix[1].toUpperCase()} CL ${appendix[2].toUpperCase()}`;
  const clause = text.match(/^(?:clause|cl\.?)\s*(\d+[a-z]*)$/i);
  if (clause) return `CLAUSE ${clause[1].toUpperCase()}`;
  return text.toUpperCase();
}

function referenceIdentity(section) {
  const key = canonicalCitationLabel(section?.citationLabel);
  const instrument = String(section?.documentSlug || section?.documentId || section?.documentCorpus || "");
  if (/^SO \d+[A-Z]*$/i.test(key)) return { kind: "standing_order", key: key.toUpperCase().replace(/^SO/, "SO"), instrument };
  if (/^\d+\/\d+$/.test(key)) return { kind: "ruling", key, instrument };
  if (/^(?:APPENDIX [A-Z] CL |CLAUSE )\d+[A-Z]*$/i.test(key)) return { kind: "clause", key: key.toUpperCase(), instrument };
  return null;
}

export function operatorCitations(text) {
  const source = String(text ?? "");
  const found = [];
  for (const match of source.matchAll(OPERATOR_WORD)) {
    const before = source.slice(Math.max(0, match.index - 24), match.index);
    if (/see also\s*$/i.test(before)) continue;
    const target = readOperatorTarget(source.slice(match.index + match[0].length));
    if (!target) continue;
    if (found.some((item) => item.kind === target.kind && item.key === target.key)) continue;
    found.push(target);
  }
  return found;
}

export function isDeclaredDefinitionUnit(section) {
  const hay = `${section?.heading ?? ""} ${(section?.path ?? []).join(" ")}`;
  return /\b(?:definitions?|interpretation)\b/i.test(hay);
}

/** Explicit instrument operators only, three hops, plus definition units those operators name. */
export function followOperatorChain(input) {
  const pool = input?.pool ?? [];
  const admitted = input?.admitted ?? [];
  const maxHops = 3;
  const visited = new Set(admitted.map((item) => item?.sectionId).filter(Boolean));
  let frontier = [...admitted];
  const found = [];
  let truncated = false;
  const sameUnit = (ref, source, candidate) => {
    const citing = referenceIdentity(source);
    const target = referenceIdentity(candidate);
    if (!target || target.kind !== ref.kind || target.key !== ref.key) return false;
    const instrument = citing?.instrument || String(source?.documentSlug || source?.documentId || source?.documentCorpus || "");
    return !instrument || !target.instrument || instrument === target.instrument;
  };
  for (let hop = 1; hop <= maxHops; hop += 1) {
    const next = [];
    for (const source of frontier) {
      for (const ref of operatorCitations(source?.sectionContent)) {
        const target = pool.find((item) => !visited.has(item?.sectionId) && sameUnit(ref, source, item));
        if (!target) {
          const already = pool.find((item) => visited.has(item?.sectionId) && sameUnit(ref, source, item));
          if (!already) truncated = true;
          continue;
        }
        if (hop === maxHops && operatorCitations(target.sectionContent).some((nextRef) => {
          const further = pool.find((item) => item?.sectionId !== target.sectionId && !visited.has(item?.sectionId) && sameUnit(nextRef, target, item));
          return Boolean(further);
        })) truncated = true;
        visited.add(target.sectionId);
        found.push(target);
        next.push(target);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return { candidates: found, truncated };
}

/**
 * supported only when the trailer says so and nothing was withheld, missing,
 * edited, repaired, or left uncertain. A model trailer can lower supported to
 * partial. not_answered comes only from abstention or a fallback, not from the trailer.
 */
export function deriveAnswerState(state) {
  const fallback = String(state?.fallbackReason ?? state?.fallbackCode ?? "none").trim();
  if (state?.abstained === true || fallback !== "none") return "not_answered";
  const partial = state?.partial ?? [];
  const blocked = partial.length > 0
    || (state?.uncertainty ?? []).length > 0
    || (state?.answerEdits ?? []).length > 0
    || state?.pruned === true
    || state?.rewritten === true
    || state?.repairAccepted === true
    || state?.settlement === "partial"
    || state?.settlement === "not_answered"
    || state?.settlement == null;
  if (blocked) return "partial";
  if (state?.settlement === "supported") return "supported";
  return "partial";
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

export function labelBareRulings(text, authorities = []) {
  const labels = new Set((authorities ?? [])
    .filter((authority) => authority?.documentCorpus === "speakers_rulings")
    .map((authority) => authority.citationLabel));
  if (labels.size === 0) return String(text ?? "");
  return String(text ?? "").replace(/(^|[^\][A-Za-z0-9/])(\d+\/\d+)(?![A-Za-z0-9/])/g, (match, prefix, label, offset, whole) => {
    if (!labels.has(label)) return match;
    const before = whole.slice(Math.max(0, offset - 24), offset + prefix.length);
    if (/ruling/i.test(before)) return match;
    const after = whole.slice(offset + match.length);
    if (/^\s+[A-Za-z]/.test(after)) return match;
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
  const partial = outcome.partial ?? [];
  return outcome.fallbackReason !== "none" || outcome.abstained === true
    || partial.includes("evidence_gap")
    || partial.includes("partial")
    || outcome.pruned === true
    || outcome.rewritten === true;
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

const FOCUS_CHARS = /^[\p{L}\p{N} .'/():_&§–—-]{1,120}$/u;

/** Drop a focus that cannot be kept. Never fail the surrounding search. */
export function normaliseSearchFocus(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, SEARCH_FOCUS_MAX_CHARS);
  if (!trimmed || trimmed.includes("..") || /[\u0000-\u001f<>]/.test(trimmed)) return null;
  return FOCUS_CHARS.test(trimmed) ? trimmed : null;
}

export function isBoundedSearchFocus(value) {
  return normaliseSearchFocus(value) === value;
}
