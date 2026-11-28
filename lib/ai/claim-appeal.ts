/**
 * v36: Independently corroborate a disputed bottom-line entailment finding.
 * A model cannot reverse its own rejection: an independent affirmative review
 * must provide actual, contiguous source quotations for EACH cited authority.
 * The production qualification veto remains decisive and is never appealed.
 */
export type AppealableClaim = { id: string; text: string; citations: string[]; lineIndex: number };
export type AppealSource = { citationLabel: string; sectionContent: string };
export type AppealWitness = { citationLabel: string; exactQuote: string };
export type AppealVerdict = {
  id: string;
  supported: boolean;
  reason: string;
  witnesses: AppealWitness[];
};
export type AppealCheck = { accepted: boolean; reason: string };

const SOURCE_PARENT = String.raw`(?:SO\s+\d+[a-z]*|Appendix\s+[A-F]\s+cl\s+\d+[a-z]*|\d+\/\d+)`;
const SOURCE_PIN = String.raw`(?:\((?:\d+[a-z]*|[a-z]{1,4})\))+`;

/** Parent authority for a citation. Letter-only, two-letter and deeper pins map back to that parent. */
export function sourceLabel(citation: string): string {
  const trimmed = citation.trim();
  const mapped = new RegExp(`^(${SOURCE_PARENT})\\s*(?:${SOURCE_PIN}(?:\\s*[-–]\\s*${SOURCE_PIN})?)?$`, "i").exec(trimmed);
  return (mapped ? mapped[1] : trimmed).replace(/\s+/g, " ");
}
function key(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}
function normaliseSourceWhitespace(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** A source-witness match is necessary, but never sufficient, to overturn a model rejection. */
export function corroborateClaimAppeal(input: {
  claim: AppealableClaim;
  verdict: AppealVerdict;
  authorities: AppealSource[];
}): AppealCheck {
  const { claim, verdict, authorities } = input;
  if (!claim?.id || verdict?.id !== claim.id || verdict.supported !== true) {
    return { accepted: false, reason: "No matching affirmative independent verdict" };
  }
  if (typeof verdict.reason !== "string" || verdict.reason.trim().length < 15) {
    return { accepted: false, reason: "Missing substantive independent reasoning" };
  }
  const allowed = new Set(claim.citations.map((c) => key(sourceLabel(c))));
  if (!allowed.size || allowed.size > 4 || !Array.isArray(verdict.witnesses) || verdict.witnesses.length < allowed.size || verdict.witnesses.length > 8) {
    return { accepted: false, reason: "Missing or excessive citation witnesses" };
  }
  const sources = new Map(authorities.map((a) => [key(a.citationLabel), a.sectionContent]));
  const covered = new Set<string>();
  for (const witness of verdict.witnesses) {
    if (!witness || typeof witness.citationLabel !== "string" || typeof witness.exactQuote !== "string") {
      return { accepted: false, reason: "Malformed source witness" };
    }
    const label = key(sourceLabel(witness.citationLabel));
    if (!allowed.has(label)) return { accepted: false, reason: "Witness uses uncited authority" };
    const source = sources.get(label);
    const quote = normaliseSourceWhitespace(witness.exactQuote);
    if (!source || quote.length < 24 || quote.length > 500 || !normaliseSourceWhitespace(source).includes(quote)) {
      return { accepted: false, reason: "Source quotation not found verbatim in selected authority" };
    }
    covered.add(label);
  }
  if ([...allowed].some((label) => !covered.has(label))) {
    return { accepted: false, reason: "Every cited authority must have a quoted source witness" };
  }
  return { accepted: true, reason: "Independent model affirmed with verified quotations for every cited authority" };
}

/** Identify only claims physically in the Bottom line section. */
export function rejectedBottomLineClaims(input: {
  answerText: string;
  claims: AppealableClaim[];
  rejectedIds: Set<string>;
  qualificationVetoIds: Set<string>;
}): AppealableClaim[] {
  const sections = input.answerText.split("\n");
  const bottomLineIndexes = new Set<number>();
  let inBottomLine = false;
  for (let i = 0; i < sections.length; i++) {
    const trimmed = sections[i].trim();
    if (trimmed === "Bottom line:") { inBottomLine = true; continue; }
    if (/^(?:What this means|Your options|Risks or constraints|Best authorities to inspect or cite):$/.test(trimmed)) inBottomLine = false;
    if (inBottomLine && trimmed) bottomLineIndexes.add(i);
  }
  return input.claims.filter((claim) =>
    bottomLineIndexes.has(claim.lineIndex) &&
    input.rejectedIds.has(claim.id) &&
    !input.qualificationVetoIds.has(claim.id),
  );
}
