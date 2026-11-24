/**
 * v35: source-attested qualification preservation for categorical legal claims.
 *
 * This is a narrow conservative check, not a replacement for semantic entailment.
 * Only an explicit exception in the same numbered source subsection as an
 * operative rule can veto a categorical claim about the same actor and action.
 * Does not infer what a cross-referenced provision says or add authorities.
 */
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
  const chunks = text.split(/(?=\(\d+[a-z]?\)\s)/i).map((part) => part.trim()).filter(Boolean);
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
function acknowledgesArm(claim: string, arm: {kind: string; text: string}): boolean {
  if (GENERIC_ACKNOWLEDGEMENT.test(claim)) return true;
  const claimNormal = normalise(claim);
  const armNormal = normalise(arm.text);
  const references = [...armNormal.matchAll(/standing\s+order\s+(\d+[a-z]?)/gi)];
  // An express reference is an adequate acknowledgement of an unexamined
  // cross-reference; we do not infer the contents of that other provision.
  if (references.some((m) => new RegExp(`\\b(?:so|standing order)\\s+${m[1]}\\b`, "i").test(claimNormal))) return true;
  if (references.length && /\b(?:cross reference|cross referenced|another specified provision|give effect)\b/i.test(claimNormal)) return true;
  const words = tokens(arm.text);
  const claimWords = new Set(tokens(claim));
  // Require a substantive distinctive phrase or two source-specific words;
  // generic 'house'/'leave' cannot erase an unrelated exception.
  if (words.length && words.filter((w) => claimWords.has(w)).length >= Math.min(2, words.length)) return true;
  if (armNormal.includes("house expressly authoris") && /\bhouse\b/i.test(claimNormal) && /\bauthoris/i.test(claimNormal)) return true;
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
      const parent = citation.replace(/(?:\(\d+[a-z]?\))+$/i, "").trim();
      const authority = authorityMap.get(normalise(parent));
      if (!authority?.sectionContent) continue;
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
        const missing = arms.filter((arm) => {
          if (arm.kind !== "other than") return !acknowledgesArm(claim.text, arm);
          const armPhrase = `${arm.kind} ${arm.text}`.toLowerCase();
          const armPosition = subsection.toLowerCase().indexOf(armPhrase);
          // Only the exception to the very same operative sentence qualifies.
          const sameSentence = armPosition >= sentenceStart && armPosition < sentenceEnd;
          if (!sameSentence) return false;
          return !acknowledgesArm(claim.text, arm);
        });
        if (!missing.length) continue;
        rejected.push({
          claimId: claim.id,
          citationLabel: authority.citationLabel,
          reason: `Categorical claim omits an express source qualification (${missing.map((arm) => arm.kind).join(", ")}) within the same operative subsection`,
        });
        break;
      }
      if (rejected.some((item) => item.claimId === claim.id)) break;
    }
  }
  return rejected;
}
