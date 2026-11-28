/**
 * v35: source-attested qualification preservation for categorical legal claims.
 *
 * This is a narrow conservative check, not a replacement for semantic entailment.
 * Only an explicit exception in the same numbered source subsection as an
 * operative rule can veto a categorical claim about the same actor and action.
 * Does not infer what a cross-referenced provision says or add authorities.
 */
import { exceptionNamesAuthorisingBody } from "@/lib/procedural-mechanisms";
import { sourceLabel } from "./claim-appeal";

export type QualificationClaim = {
  id: string;
  text: string;
  citations: string[];
};
export type QualificationAuthority = {
  citationLabel: string;
  sectionContent: string;
};
export type QualificationRejection = {
  claimId: string;
  citationLabel: string;
  reason: string;
};

const RESTRICTION = /\b(?:may\s+not|must\s+not|shall\s+not|cannot|can't|must|shall|may\s+only|can\s+only|is\s+prohibited|are\s+prohibited|is\s+not\s+permitted|are\s+not\s+permitted)\b/i;
// A restriction can be expressed as a requirement for one specific permission,
// not just as "may not ... unless". v34 missed the live phrasing
// "Disclosing ... requires express authorisation" and let it survive pruning.
const CATEGORICAL = /\b(?:may\s+not|must\s+not|shall\s+not|cannot|can't|must|shall|never|only|solely|exclusively|prohibit\w*|not\s+(?:permitted|allowed|authorised|authorized)|without\s+|unless\s+|require\w*|need(?:s|ed)?|necessar(?:y|ily)|prerequisite)\b/i;
const EXCEPTION = /\b(?:except(?:\s+for|\s+to)?|unless|provided\s+that|subject\s+to|other\s+than)\b/gi;
const GENERIC_ACKNOWLEDGEMENT = /\b(?:other\s+exceptions?|additional\s+exceptions?|specified\s+exceptions?|cross[- ]referenced\s+(?:exception|provision)|subject\s+to\s+(?:other|specified|the)\s+(?:exceptions?|provisions?)|except\s+as\s+otherwise\s+(?:provided|permitted)|unless\s+otherwise\s+(?:provided|permitted))\b/i;
const NONCONTENT = new Set(["the","a","an","is","are","be","been","being","to","of","in","on","at","for","from","with","by","or","and","but","if","that","this","those","these","it","its","as","any","all","some","each","another","other","may","must","shall","not","only","can","could","will","would","should","who","which","where","when","while","under","over","their","there","person","persons","member","members","house","order","orders","standing","committee","committees","rule","rules","leave","given","required","evidence","result","secret","private","report","reported","authority","authorised","authorized","expressly","except","unless","without","give","effect","and","subsection","section","prohibited","permitted"]);

function normalise(text: string): string {
  return text.toLowerCase().replace(/[’‘]/g, "'").replace(/\[[^\]]+\]/g, " ").replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();
}

function root(word: string): string {
  return word.replace(/(?:ingly|edly|ing|ed|es|s)$/i, "").replace(/e$/, "");
}
function tokens(text: string): string[] {
  return normalise(text).split(" ").filter((token) => !NONCONTENT.has(token)).map(root).filter((token) => token.length >= 4 && !NONCONTENT.has(token));
}
function includesAction(claim: string, operative: string): boolean {
  const match = RESTRICTION.exec(operative);
  if (!match) return false;
  // The first meaningful word after the source's modal is its operative act.
  const after = operative.slice(match.index + match[0].length).split(/\s+/).slice(0, 12);
  const candidates = tokens(after.join(" "));
  const claimWords = new Set(tokens(claim));
  return candidates.slice(0, 3).some((word) => {
    if (claimWords.has(word)) return true;
    // Conservative derivational equivalence: "disclosure"/"disclose" and
    // "reporting"/"report" may differ by a short suffix. Do not substitute
    // semantically related but distinct acts or use a heading as evidence.
    return [...claimWords].some((claimWord) =>
      word.length >= 6 && claimWord.length >= 6 &&
      Math.abs(word.length - claimWord.length) <= 3 &&
      (word.startsWith(claimWord) || claimWord.startsWith(word))
    );
  });
}
function hasSubjectOverlap(claim: string, operative: string): boolean {
  const modal = RESTRICTION.exec(operative);
  if (!modal) return false;
  // Require a subject/topic witness as well as an action witness; a merely
  // adjacent rule elsewhere in the authority does not qualify.
  const beforeModal = operative.slice(Math.max(0, modal.index - 160), modal.index);
  const prefix = beforeModal.split(/[,.;]/).at(-1) ?? beforeModal;
  const words = tokens(prefix);
  const claimWords = new Set(tokens(claim));
  // Subjects such as 'secret evidence' can otherwise reduce to stopwords;
  // preserve their paired content for the overlap check.
  const topicWords = normalise(prefix).split(" ").filter((w) => w.length >= 5);
  const claimNormal = ` ${normalise(claim)} `;
  return words.some((w) => claimWords.has(w)) || topicWords.some((w) => claimNormal.includes(` ${w} `));
}
function numberedSubsections(text: string): string[] {
  // Do not split lettered lists: the exception and governing rule must remain
  // together even where nested (a)/(b) paragraphs occur.
  const chunks = text.split(/(?=\(\d+[a-z]*\)\s)/i).map((part) => part.trim()).filter(Boolean);
  return chunks.length ? chunks : [text];
}
function exceptionArms(subsection: string): Array<{kind: string; text: string}> {
  const result: Array<{kind: string; text: string}> = [];
  const matches = [...subsection.matchAll(EXCEPTION)];
  for (const m of matches) {
    if (m.index === undefined) continue;
    const start = m.index + m[0].length;
    // Stop at the next operative clause, punctuation boundary, or another arm.
    const remaining = subsection.slice(start);
    const next = /[,;.]|\b(?:unless|except|provided\s+that|subject\s+to)\b/i.exec(remaining);
    const arm = (next ? remaining.slice(0, next.index) : remaining).trim();
    if (arm.length >= 4 && arm.length < 300) result.push({kind: m[0].toLowerCase(), text: arm});
  }
  return result;
}
function claimSentences(text: string): string[] {
  const sentences: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of text) {
    if (char === "[") depth += 1;
    if (char === "]" && depth > 0) depth -= 1;
    current += char;
    if (depth === 0 && /[.!?]/.test(char)) {
      if (current.trim()) sentences.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) sentences.push(current.trim());
  return sentences.length > 0 ? sentences : [text.trim()];
}

/** Sentences that carry this citation, plus categorical sentences it governs. */
function sentencesForCitation(claim: string, citation: string): string[] {
  const sentences = claimSentences(claim);
  const needle = citation.trim();
  const carries = sentences.filter((sentence) => sentence.includes(needle) || sentence.includes(`[${needle}]`));
  const governed = sentences.filter((sentence) => !/\[[^\]]+\]/.test(sentence) && CATEGORICAL.test(sentence));
  const scope = [...carries, ...governed.filter((sentence) => !carries.includes(sentence))];
  return scope.length > 0 ? scope : sentences;
}

function carriesCitation(sentence: string, citation: string): boolean {
  const needle = citation.trim();
  return needle.length > 0 && (sentence.includes(needle) || sentence.includes(`[${needle}]`));
}

function armActor(arm: string): string | null {
  const match = arm.match(/\b(speaker|clerk|chairperson|committee|house|member)\b/i);
  return match ? match[1].toLowerCase() : null;
}

function armCondition(arm: string): string | null {
  const match = arm.match(/\b(leave|permission|permits|permit|authorises|authorised|authorizes|authorized|consents|consent|approval)\b/i);
  return match ? match[1].toLowerCase().replace(/(?:s|ed|ing|ion)$/i, "") : null;
}

function differentAct(sentence: string, claim: string, arm: string): boolean {
  const claimNorm = normalise(claim);
  const armNorm = normalise(arm);
  const verbs = [...normalise(sentence).matchAll(/\b(?:may|must|shall|can)\s+(\w+)/g)].map((match) => match[1] ?? "");
  return verbs.some((verb) => {
    if (!verb || /^(give|grant|permit|authorise|authorize)$/.test(verb)) return false;
    if (armNorm.includes(verb) || claimNorm.includes(verb)) return false;
    return true;
  });
}

function permissionNegated(sentence: string): boolean {
  return /\b(?:may not|shall not|must not|cannot|can't|can not|is not permitted|are not permitted|is not allowed|are not allowed|without(?:\s+the)?\s+leave)\b/i.test(sentence);
}

function actorIsPositive(sentence: string, actor: string): boolean {
  if (!sentence.toLowerCase().includes(actor)) return false;
  const denied = new RegExp(String.raw`\b(?:not|other than|rather than|except|without|neither|nor)\s+(?:the\s+)?${actor}\b`, "i");
  return !denied.test(sentence);
}

function ruleActStem(ruleSentence: string): string {
  const match = ruleSentence.match(/\b(?:must|shall|may|cannot|can't)\s+(?:not\s+)?(\w+)/i);
  const verb = (match?.[1] ?? "").toLowerCase();
  if (!verb || /^(?:not|be|have|do|give|grant)$/.test(verb)) return "";
  return verb.replace(/(?:ing|ion|e)$/i, "");
}

function governsSameAct(neighbor: string, ruleSentence: string): boolean {
  const stem = ruleActStem(ruleSentence);
  if (stem.length < 4) return false;
  return neighbor.toLowerCase().includes(stem);
}

function broaderThanSource(sentence: string): boolean {
  return /\b(?:at any time|at all times|always|whenever|in any case|any member may|any person may|never required|no longer required|leave is not required)\b/i.test(sentence);
}

/**
 * An adjacent sentence states the source exception only when every guard holds.
 * A However lead-in, a negated permission, or a different act is not enough.
 */
function isAdjacentException(neighbor: string, arm: { kind: string; text: string }, citation: string, claimSentence: string): boolean {
  const armText = `${arm.kind} ${arm.text}`;
  if (!carriesCitation(neighbor, citation)) return false;
  if (permissionNegated(neighbor)) return false;
  if (broaderThanSource(neighbor)) return false;
  if (/\b(?:elsewhere|different matter|many things|other matters|unrelated|something else)\b/i.test(neighbor)) return false;
  const actor = armActor(armText);
  const condition = armCondition(armText);
  if (!actor || !condition) return false;
  if (!actorIsPositive(neighbor, actor)) return false;
  if (!neighbor.toLowerCase().includes(condition)) return false;
  if (!governsSameAct(neighbor, claimSentence)) return false;
  if (differentAct(neighbor, claimSentence, armText)) return false;
  return true;
}

function qualificationStated(sentence: string, sentences: string[], arm: { kind: string; text: string }, citation: string, claim: string): boolean {
  if (acknowledgesArm(sentence, arm)) return true;
  const index = sentences.indexOf(sentence);
  const neighbors = [sentences[index - 1], sentences[index + 1]].filter((item): item is string => Boolean(item));
  return neighbors.some((neighbor) => isAdjacentException(neighbor, arm, citation, sentence));
}

function acknowledgesArm(claim: string, arm: {kind: string; text: string}): boolean {
  if (GENERIC_ACKNOWLEDGEMENT.test(claim)) return true;
  const claimNormal = normalise(claim);
  const armNormal = normalise(arm.text);
  const references = [...armNormal.matchAll(/standing\s+order\s+(\d+[a-z]*)\b/gi)];
  // An express reference is an adequate acknowledgement of an unexamined
  // cross-reference; we do not infer the contents of that other provision.
  if (references.some((m) => new RegExp(`\\b(?:so|standing order)\\s+${m[1]}\\b`, "i").test(claimNormal))) return true;
  if (references.length && /\b(?:cross reference|cross referenced|another specified provision|give effect)\b/i.test(claimNormal)) return true;
  const words = tokens(arm.text);
  const claimWords = new Set(tokens(claim));
  // Require a substantive distinctive phrase or two source-specific words;
  // generic 'house'/'leave' cannot erase an unrelated exception.
  if (words.length && words.filter((w) => claimWords.has(w)).length >= Math.min(2, words.length)) return true;
  if (exceptionNamesAuthorisingBody(`${arm.kind} ${arm.text}`) && exceptionNamesAuthorisingBody(claim)) return true;
  return false;
}

/** Check each claim against only its expressly cited, available source. */
export function findOmittedSourceQualifications(input: {
  claims: QualificationClaim[];
  authorities: QualificationAuthority[];
}): QualificationRejection[] {
  const authorityMap = new Map(input.authorities.map((a) => [normalise(a.citationLabel), a]));
  const rejected: QualificationRejection[] = [];
  for (const claim of input.claims) {
    if (!CATEGORICAL.test(claim.text)) continue;
    for (const citation of claim.citations) {
      // Section qualifiers cite the same selected parent authority, but a
      // reference alone must never manufacture another available source.
      if (citation.trim().toLowerCase() === "citation not verified") continue;
      const labels = joinedCitationLabels(citation);
      let vetoed = false;
      for (const label of labels) {
      const parent = sourceLabel(label);
      const authority = authorityMap.get(normalise(parent));
      if (!authority?.sectionContent) {
        // An unmapped citation is a veto. Skipping it let a comma edition and a
        // two-label bracket past the exception check.
        rejected.push({
          claimId: claim.id,
          citationLabel: citation.trim(),
          reason: "Pinpoint could not be mapped to an admitted source",
        });
        vetoed = true;
        break;
      }
      for (const subsection of numberedSubsections(authority.sectionContent)) {
        const operativeMatch = RESTRICTION.exec(subsection);
        if (!operativeMatch) continue;
        const arms = exceptionArms(subsection);
        if (arms.length === 0) continue;
        // Exclude exception text from action/subject evidence. This prevents
        // spurious matching against an unrelated exception in a cited section.
        const sourceWithoutArms = subsection.replace(EXCEPTION, " ");
        if (!includesAction(claim.text, sourceWithoutArms) || !hasSubjectOverlap(claim.text, sourceWithoutArms)) continue;
        // An "other than" qualification may govern an unrelated sentence in
        // the same numbered subsection, despite governing a different act.
        // Preserve same-sentence carve-outs and every other explicit exception
        // type under the existing conservative guard.
        const modalStart = operativeMatch.index;
        const sentenceStart = Math.max(0, subsection.lastIndexOf(".", modalStart) + 1);
        const sentenceEndFound = subsection.indexOf(".", modalStart);
        const sentenceEnd = sentenceEndFound < 0 ? subsection.length : sentenceEndFound + 1;
        const restrictionSentence = subsection.slice(sentenceStart, sentenceEnd);
        const sentences = claimSentences(claim.text);
        const scope = sentencesForCitation(claim.text, citation);
        const missing = arms.filter((arm) => {
          const stated = scope.every((sentence) => qualificationStated(sentence, sentences, arm, citation, sentence));
          if (arm.kind !== "other than") return !stated;
          const armPhrase = `${arm.kind} ${arm.text}`.toLowerCase();
          const armPosition = subsection.toLowerCase().indexOf(armPhrase);
          // Only the exception to the very same operative sentence qualifies.
          const sameSentence = armPosition >= sentenceStart && armPosition < sentenceEnd;
          if (!sameSentence) return false;
          return !stated;
        });
        if (!missing.length) continue;
        rejected.push({
          claimId: claim.id,
          citationLabel: authority.citationLabel,
          reason: `Categorical claim omits an express source qualification (${missing.map((arm) => arm.kind).join(", ")}) within the same operative subsection`,
        });
        vetoed = true;
        break;
      }
      if (vetoed) break;
      }
      if (vetoed) break;
    }
  }
  return rejected;
}

/** And/or/& joins and numeric ranges are checked label by label. Pin continuations stay one citation. */
function joinedCitationLabels(citation: string): string[] {
  const flat = citation.trim().replace(/\s+/g, " ").replace(/--|[‐‑‒–—−]/g, "-");
  if (/\([^)]+\)\s*(?:and|or|&)\s*\(/i.test(flat)) return [flat];
  const range = /^(?:standing orders?|s\.?\s*o\.?s?|so)\s*(\d+)\s*(?:to|through|-)\s*(\d+)$/i.exec(flat);
  if (range) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    if (to >= from && to - from <= 100) {
      return Array.from({ length: to - from + 1 }, (_, index) => `SO ${from + index}`);
    }
  }
  const parts = flat.split(/\s*(?:&|\band\b|\bor\b)\s*/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return [flat];
  let prefix = "";
  return parts.map((part) => {
    if (/^\d+[a-z]*$/i.test(part) && prefix) return `${prefix}${part}`.replace(/\s+/g, " ");
    const lead = part.match(/^(.*?)(?=\d)/);
    if (lead && /so|standing|appendix|sr|s\.?\s*[or]/i.test(lead[1])) prefix = lead[1];
    return part;
  });
}
