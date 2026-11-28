import { buildProvisionTree } from "@/lib/citations/grammar";

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

/** Drop only the current edition phrase, so a comma or parenthetical year still names its authority. */
function withoutCurrentEdition(citation: string): string {
  const flat = citation.trim().replace(/\s+/g, " ");
  const ruling = /\d+\s*\/\s*\d+/.test(flat) && !/\b(?:so|standing orders?|appendix)\b/i.test(flat);
  const year = ruling ? "2023" : "2026";
  return flat
    .replace(new RegExp(String.raw`,?\s*\(\s*${year}\s+(?:edition|edn|revision)\s*\)`, "ig"), "")
    .replace(new RegExp(String.raw`,\s*${year}\s+(?:edition|edn|revision)\b`, "ig"), "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parent authority for a citation. Letter-only, two-letter and deeper pins map back to that parent. */
export function sourceLabel(citation: string): string {
  const trimmed = withoutCurrentEdition(citation).replace(/--|[‐‑‒–—−]/g, "-");
  const repeated = /^(?:standing orders?|s\.?\s*o\.?|so)\s*(\d+)(?:\([^)]+\))*\s*-\s*(?:standing orders?|s\.?\s*o\.?|so)\s*\1\b/i.exec(trimmed);
  if (repeated) return `SO ${repeated[1]}`;
  const normalized = trimmed.replace(/^(?:standing orders?|s\.?\s*o\.?s?)\s+/i, "SO ");
  const one = `${SOURCE_PIN}(?:\\s*(?:-|–|—|to|through)\\s*${SOURCE_PIN})?`;
  const tail = `(?:\\s*${one}(?:\\s*(?:,|and|or)\\s*${one})*)?`;
  const mapped = new RegExp(`^(${SOURCE_PARENT})${tail}$`, "i").exec(normalized);
  return (mapped ? mapped[1] : trimmed).replace(/\s+/g, " ");
}
function key(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function pinGroups(citation: string): string[] {
  const normalized = withoutCurrentEdition(citation).replace(/^(?:standing orders?|s\.?\s*o\.?s?)\s+/i, "SO ");
  const parent = sourceLabel(citation).replace(/\s+/g, " ");
  if (!normalized.toLowerCase().startsWith(parent.toLowerCase())) return [];
  return [...normalized.slice(parent.length).matchAll(/\(([^)]*)\)/g)].map((match) => match[1].trim().toLowerCase()).filter(Boolean);
}

function markerOf(line: string): string | null {
  const match = /^\s*\(([^)]+)\)/.exec(line);
  return match ? match[1].trim().toLowerCase() : null;
}

function childKey(tree: Set<string>, parent: string, token: string): string | null {
  const wanted = `${parent}(${token})`.toLowerCase();
  for (const key of tree) {
    if (key.toLowerCase() === wanted) return key;
  }
  return null;
}

/**
 * Text of the cited pin, including its child markers.
 * Letter and roman depth come from the provision tree, so (i) after (h) stays a letter.
 */
export function citedSubitemText(sectionContent: string, citation: string): string | null {
  const pins = pinGroups(citation);
  if (pins.length === 0) return sectionContent;
  const treeList = buildProvisionTree(sourceLabel(citation), sectionContent);
  if (treeList.length === 0) return null;
  const tree = new Set(treeList);
  const root = treeList.reduce((best, key) => (key.length < best.length ? key : best));
  const target = pins.reduce<string | null>((parent, pin) => (parent ? childKey(tree, parent, pin) : null), root);
  if (!target) return null;
  const lines = sectionContent.split("\n");
  const stack = [root];
  const marked: Array<{ line: number; key: string }> = [];
  lines.forEach((line, index) => {
    const token = markerOf(line);
    if (!token) return;
    const frames = [...stack];
    let found: string | null = null;
    while (frames.length > 0) {
      const parent = frames[frames.length - 1];
      const key = parent ? childKey(tree, parent, token) : null;
      if (key) {
        found = key;
        stack.splice(0, stack.length, ...frames, key);
        break;
      }
      frames.pop();
    }
    if (found) marked.push({ line: index, key: found });
  });
  const start = marked.find((entry) => entry.key.toLowerCase() === target.toLowerCase());
  if (!start) return null;
  let end = lines.length;
  for (const entry of marked) {
    if (entry.line <= start.line) continue;
    const same = entry.key.toLowerCase() === target.toLowerCase();
    const child = entry.key.toLowerCase().startsWith(`${target.toLowerCase()}(`);
    if (!same && !child) {
      end = entry.line;
      break;
    }
  }
  return lines.slice(start.line, end).join("\n");
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
    const pinned = claim.citations.filter((citation) => key(sourceLabel(citation)) === label && pinGroups(citation).length > 0);
    const insidePin = pinned.length === 0 || pinned.some((citation) => {
      const region = citedSubitemText(source, citation);
      return region !== null && normaliseSourceWhitespace(region).includes(quote);
    });
    if (!insidePin) return { accepted: false, reason: "Source quotation is outside the cited sub-item" };
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
