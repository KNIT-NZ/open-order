import { usableSourceAnchor } from "@/lib/procedural-mechanisms";
import type {
  AiDiagnosticTopResult,
  AiDiagnostics,
  AiSourceDisposition,
  SearchResult,
} from "./types";
import { clientCheckNote } from "./client-check-note";
import { publicScenarioAdjudication } from "./public-diagnostics";

export function corpusLabel(corpus: string): string {
  switch (corpus) {
    case "standing_orders":
      return "Standing Orders";
    case "speakers_rulings":
      return "Speakers' Rulings";
    default:
      return corpus;
  }
}

export function resultReason(result: SearchResult): string {
  const signals = result.matchSignals;

  if (signals.exactSectionKeyMatch || signals.exactCitationMatch) {
    return "Exact citation";
  }

  if (signals.exactHeadingMatch) {
    return "Exact heading";
  }

  if (signals.headingPhraseMatch) {
    return "Heading phrase";
  }

  if (signals.bodyPhraseMatch) {
    return "Body phrase";
  }

  return "Ranked match";
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]+>/g, "");
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function firstWords(text: string, wordCount = 10): string {
  return normalizeWhitespace(text)
    .split(" ")
    .filter(Boolean)
    .slice(0, wordCount)
    .join(" ");
}

export function buildTextFragmentStart(result: SearchResult): string | null {
  const content = normalizeWhitespace(stripHtmlTags(result.sectionContent));
  if (!content) return null;

  const initial = firstWords(content, 10);
  if (!initial) return null;

  return initial;
}

export function buildSourceHref(result: SearchResult): string | null {
  if (!result.sourceUrl) return null;

  const textStart = buildTextFragmentStart(result);
  const baseUrl = result.sourceUrl.split("#")[0];
  // Corrected provisions may link to the official Word volume, not stale HTML.
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

export function buildCanonicalCitationHref(
  citationLabel: string,
  corpus: string,
  focus: string,
): string {
  const params = new URLSearchParams({
    q: citationLabel,
    corpus,
    focus,
  });

  return `/?${params.toString()}`;
}

export function formatInlineStructure(html: string): string {
  let output = html;

  output = output.replace(
    /^(\(\d+[A-Z]?\))/gm,
    '<span class="oo-clauseLabel">$1</span>',
  );

  output = output.replace(
    /(^|\s)(\([a-z]\))(?=\s)/g,
    '$1<span class="oo-subclauseLabel">$2</span>',
  );

  output = output.replace(
    /(^|\s)(\([ivx]+\))(?=\s)/gi,
    '$1<span class="oo-subclauseLabel">$2</span>',
  );

  output = output.replace(
    /^•\s+(.*)$/gm,
    '<span class="oo-bulletRow"><span class="oo-bulletLabel">•</span><span>$1</span></span>',
  );

  return output;
}

export function splitIntoParagraphs(htmlLikeText: string): string[] {
  return htmlLikeText
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function buildFormattedSectionHtml(result: SearchResult): string {
  const base =
    result.sectionContentHighlighted && result.sectionContentHighlighted.trim()
      ? result.sectionContentHighlighted
      : escapeHtml(result.sectionContent);

  const paragraphs = splitIntoParagraphs(base);

  return paragraphs
    .map((paragraph) => {
      const trimmed = paragraph.trim();

      if (/^•\s+/m.test(trimmed)) {
        const bulletLines = trimmed
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => formatInlineStructure(line))
          .join("");

        return `<div class="oo-sectionBlock oo-sectionBlockBullets">${bulletLines}</div>`;
      }

      if (
        /^(\(\d+[A-Z]?\)|\([a-z]\)|\([ivx]+\))/i.test(trimmed) ||
        /(^|\s)(\([a-z]\)|\([ivx]+\))/i.test(trimmed)
      ) {
        return `<div class="oo-sectionBlock oo-sectionBlockClause">${formatInlineStructure(
          trimmed,
        )}</div>`;
      }

      return `<p class="oo-sectionParagraph">${formatInlineStructure(
        trimmed,
      )}</p>`;
    })
    .join("");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "absolute";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      const succeeded = document.execCommand("copy");
      document.body.removeChild(textarea);
      return succeeded;
    } catch {
      return false;
    }
  }
}

const AI_INLINE_LABELS = [
  "Bottom line",
  "What this means",
  "Why this matters",
  "In practice",
  "Key point",
  "Takeaway",
  "Next step",
];

function renderAuthorityPills(text: string): string {
  return text
    .replace(
      /\*\*([0-9]+\/[0-9A-Z]+)\*\*/g,
      '<span class="oo-aiAuthorityPill">$1</span>',
    )
    .replace(/\[([^\]]+)\]/g, (_match, inner: string) => {
      const refs = inner
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);

      const validRefs = refs.filter((ref) => /^[0-9]+\/[0-9A-Z]+$/.test(ref));

      if (validRefs.length === 0) {
        return `[${inner}]`;
      }

      return validRefs
        .map((ref) => `<span class="oo-aiAuthorityPill">${ref}</span>`)
        .join(" ");
    });
}

function renderInlineLeadLabel(text: string): string {
  for (const label of AI_INLINE_LABELS) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const colonPattern = new RegExp(`^(${escapedLabel})\\s*:\\s*`, "i");
    if (colonPattern.test(text)) {
      return text.replace(
        colonPattern,
        '<span class="oo-aiInlineLabel">$1</span><span class="oo-aiInlineLabelColon">:</span> ',
      );
    }

    const barePattern = new RegExp(`^(${escapedLabel})(?=\\s|—|–|-)`, "i");
    if (barePattern.test(text)) {
      return text.replace(
        barePattern,
        '<span class="oo-aiInlineLabel">$1</span>',
      );
    }
  }

  return text;
}

function renderAnswerInline(text: string): string {
  return renderInlineLeadLabel(renderAuthorityPills(text));
}

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, "").trim();
}

function normalizeHeadingText(text: string): string {
  return text.replace(/\s*:\s*$/, "").trim();
}

function isBulletHeading(text: string): boolean {
  const plain = normalizeHeadingText(stripTags(text));

  if (!plain) return false;
  if (plain.length > 56) return false;

  return true;
}

export function renderAiAnswerHtml(answerText: string): string {
  const escaped = escapeHtml(answerText);
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const blocks: string[] = [];

  for (const paragraph of paragraphs) {
    if (/^- /m.test(paragraph)) {
      const rawItems = paragraph
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^- /, "").trim());

      const groups: Array<{ heading: string | null; items: string[] }> = [];
      let currentHeading: string | null = null;
      let currentItems: string[] = [];

      const flush = () => {
        if (currentHeading || currentItems.length > 0) {
          groups.push({
            heading: currentHeading,
            items: currentItems,
          });
        }
        currentHeading = null;
        currentItems = [];
      };

      for (const rawItem of rawItems) {
        const renderedItem = renderAnswerInline(rawItem);

        if (isBulletHeading(renderedItem)) {
          flush();
          currentHeading = normalizeHeadingText(renderedItem);
        } else {
          currentItems.push(renderedItem);
        }
      }

      flush();

      for (const group of groups) {
        const headingHtml = group.heading
          ? `<div class="oo-aiSectionHeading">${group.heading}</div>`
          : "";

        const listHtml =
          group.items.length > 0
            ? `<ul class="oo-aiList">${group.items
                .map((item) => `<li class="oo-aiListItem">${item}</li>`)
                .join("")}</ul>`
            : "";

        if (headingHtml || listHtml) {
          blocks.push(
            `<div class="oo-aiSectionGroup">${headingHtml}${listHtml}</div>`,
          );
        }
      }

      continue;
    }

    const renderedParagraph = renderAnswerInline(paragraph);
    blocks.push(
      `<div class="oo-aiSectionGroup"><p class="oo-aiParagraph">${renderedParagraph}</p></div>`,
    );
  }

  return blocks.join('<hr class="oo-aiSectionRule" />');
}

export function formatMatchSignals(
  signals: AiDiagnosticTopResult["matchSignals"],
): string {
  const parts: string[] = [];

  if (signals.exactSectionKeyMatch) parts.push("exact section");
  if (signals.exactCitationMatch) parts.push("exact citation");
  if (signals.exactHeadingMatch) parts.push("exact heading");
  if (signals.headingPhraseMatch) parts.push("heading phrase");
  if (signals.bodyPhraseMatch) parts.push("body phrase");
  if (signals.pathPhraseMatch) parts.push("path phrase");

  return parts.length > 0 ? parts.join(", ") : "none";
}

// The route's fixed-format prune count passes as written; any other text goes
// through the code filter.
const ROUTE_PRUNE_NOTE = /^Pruned unsupported lines: \d{1,4}$/;
function publicPruneNote(note: string | null | undefined): string | null {
  if (typeof note === "string" && ROUTE_PRUNE_NOTE.test(note)) return note;
  return clientCheckNote([note]);
}

export function formatAiDebugSnapshot(input: AiDiagnostics): string {
  const searchQueries = input.plan?.searchQueries?.length
    ? input.plan.searchQueries.map((q, i) => `${i + 1}. ${q}`).join("\n")
    : "None";

  const salientTermsText = input.plan?.salientTerms?.length
    ? input.plan.salientTerms.map((term, i) => `${i + 1}. ${term}`).join("\n")
    : "None";

  const inferredConceptsText =
    input.inferredConcepts.length > 0
      ? input.inferredConcepts.map((c, i) => `${i + 1}. ${c}`).join("\n")
      : "None";

  const expandedQueriesText =
    input.expandedQueries.length > 0
      ? input.expandedQueries.map((q, i) => `${i + 1}. ${q}`).join("\n")
      : "None";

  const blueprintSlotsText =
    input.blueprintSlots.length > 0
      ? input.blueprintSlots.map((slot, i) => `${i + 1}. ${slot}`).join("\n")
      : "None";

  const requiredSlotsText =
    input.requiredSlots.length > 0
      ? input.requiredSlots.map((slot, i) => `${i + 1}. ${slot}`).join("\n")
      : "None";

  const optionalSlotsText =
    input.optionalSlots.length > 0
      ? input.optionalSlots.map((slot, i) => `${i + 1}. ${slot}`).join("\n")
      : "None";

  const satisfiedSlotsText =
    input.satisfiedSlots.length > 0
      ? input.satisfiedSlots.map((slot, i) => `${i + 1}. ${slot}`).join("\n")
      : "None";

  const missingRequiredSlotsText =
    input.missingRequiredSlots.length > 0
      ? input.missingRequiredSlots
          .map((slot, i) => `${i + 1}. ${slot}`)
          .join("\n")
      : "None";

  const selectedSlotMatchesText =
    input.selectedSlotMatches.length > 0
      ? input.selectedSlotMatches
          .map(
            (match, index) =>
              `${index + 1}. ${match.slotKey} -> ${match.citationLabel} (${match.heading ?? "None"})`,
          )
          .join("\n")
      : "None";

  const retrievalsText =
    input.retrievals.length > 0
      ? input.retrievals
          .map((retrieval, retrievalIndex) => {
            const topResultsText =
              retrieval.topResults.length > 0
                ? retrieval.topResults
                    .map((result, resultIndex) => {
                      return [
                        `    ${resultIndex + 1}. ${result.citationLabel}`,
                        `       corpus: ${result.documentCorpus}`,
                        `       title: ${result.documentTitle}`,
                        `       heading: ${result.heading ?? "None"}`,
                        `       sectionKey: ${result.sectionKey}`,
                        `       rank: ${result.rank.toFixed(2)}`,
                        `       sectionRank: ${result.sectionRank.toFixed(2)}`,
                        `       pathRank: ${result.pathRank.toFixed(2)}`,
                        `       bodyRank: ${result.bodyRank.toFixed(2)}`,
                        `       chunkRank: ${
                          result.chunkRank !== null
                            ? result.chunkRank.toFixed(2)
                            : "None"
                        }`,
                        `       clusterSupportCount: ${result.clusterSupportCount}`,
                        `       matchSignals: ${formatMatchSignals(
                          result.matchSignals,
                        )}`,
                      ].join("\n");
                    })
                    .join("\n")
                : "    None";

            const discoveryText = retrieval.discovery
              ? [
                  `   Discovery status: ${retrieval.discovery.status}`,
                  `   Discovery concept: ${retrieval.discovery.conceptId}`,
                  `   Discovery heading: ${retrieval.discovery.heading ?? "None"}`,
                  `   Discovery evidence count: ${retrieval.discovery.evidenceCount}`,
                  `   Discovery slot: ${retrieval.discovery.slotKey ?? "None"}`,
                  `   Discovery bridge source query: ${retrieval.discovery.bridgeSourceQuery ?? "None"}`,
                  `   Discovery bridge source authority: ${retrieval.discovery.bridgeSourceCitationLabel ?? "None"}`,
                  `   Discovery validation: ${retrieval.discovery.validation}`,
                ]
              : ["   Discovery status: not evaluated"];

            return [
              `${retrievalIndex + 1}. Query: ${retrieval.query}`,
              `   Corpus: ${retrieval.corpus ?? "Auto"}`,
              `   Provenance: ${retrieval.provenance ?? "unknown"}`,
              ...discoveryText,
              `   Result count: ${retrieval.resultCount}`,
              `   Top results:`,
              topResultsText,
            ].join("\n");
          })
          .join("\n\n")
      : "None";

  const finalAuthoritySelectionText =
    input.finalAuthoritySelection.length > 0
      ? input.finalAuthoritySelection
          .map((item, index) => {
            const path = item.path?.length ? item.path.join(" > ") : "None";

            return [
              `${index + 1}. ${item.citationLabel}`,
              `   query: ${item.query}`,
              `   corpus: ${item.documentCorpus}`,
              `   heading: ${item.heading ?? "None"}`,
              `   retrievalRank: ${item.baseRank.toFixed(2)} (not semantic confidence)`,
              `   authorityFunction: ${item.authorityFunction ?? "None"}`,
              `   path: ${path}`,
            ].join("\n");
          })
          .join("\n\n")
      : "None";

  const authoritiesText =
    input.authorities.length > 0
      ? input.authorities
          .map((authority, index) => {
            const path = authority.path?.length
              ? authority.path.join(" > ")
              : "None";

            return [
              `${index + 1}. ${authority.citationLabel}`,
              `   corpus: ${authority.documentCorpus}`,
              `   heading: ${authority.heading ?? "None"}`,
              `   sectionKey: ${authority.sectionKey}`,
              `   rank: ${authority.rank.toFixed(2)}`,
              `   path: ${path}`,
              `   sourceHref: ${authority.sourceHref ?? "None"}`,
            ].join("\n");
          })
          .join("\n\n")
      : "None";

  const selector = input.selectorSummary;
  const semanticSummary = selector
    ? [
        "Selector: v5.18 semantic authority pack (not the legacy blueprint)",
        `Candidate authorities evaluated: ${selector.candidateCount}`,
        `Final authorities selected: ${selector.selectedLabels.join(", ") || "None"}`,
        `Minimum obligation coverage: ${selector.minObligationCoverage.toFixed(3)}`,
        `All semantic obligations met by selector: ${selector.allObligationsComplete ? "Yes" : "No"}`,
        "Per-obligation coverage:",
        ...selector.obligationDetails.slice(0, 12).map((detail, index) =>
          `  ${index + 1}. ${detail.coverage.toFixed(3)} (${detail.complete ? "complete" : "incomplete"})`),
        `Selection before redundancy pruning: ${selector.prePruneCount ?? selector.prePruneLabels?.length ?? 0}`,
      ].join("\n")
    : "Semantic selection summary: Not received";

  // Print only the public form: counts and reason codes for refusals, no adjudicator free text.
  const adjudication = selector?.scenarioAdjudication
    ? publicScenarioAdjudication(selector.scenarioAdjudication) : undefined;
  const admittedRows = (rows: AiSourceDisposition[]) =>
    rows.map((row) => `  ${row.corpus}:${row.citationLabel} — admitted; ${row.role ?? "no role"}; ${row.reason}`);
  const adjudicationSummary = adjudication ? [
    `Status: ${/^[a-z0-9_:-]+$/i.test(adjudication.status) ? adjudication.status : "other"}`,
    `Dossier count: ${adjudication.candidateCount}; primary review attempts: ${adjudication.providerAttempts}`,
    `Dossier: ${adjudication.dossier?.join(", ") || "None reported"}`,
    `Retrieved outside dossier (bounded): ${adjudication.retrievedOutsideDossier?.join(", ") || "None reported"}`,
    `Final accepted: ${adjudication.selected.join(", ") || "None"}`,
    `Primary refusals: ${adjudication.rejected.join("; ") || "None"}`,
    `Unknown nominations: ${adjudication.unavailableNominations ?? "Not reported"}`,
    `Primary dispositions: ${adjudication.dispositionCounts?.join("; ") || "None reported"}`,
    ...admittedRows(adjudication.dispositions),
    `Recovery: ${adjudication.recovery.status}`,
    `Recovery candidates: ${adjudication.recovery.candidates.join(", ") || "None"}`,
    `Recovery accepted: ${adjudication.recovery.selected.join(", ") || "None"}`,
    `Recovery refusals: ${adjudication.recovery.rejected.join("; ") || "None"}`,
    `Recovery unknown nominations: ${adjudication.recovery.unavailableNominations ?? "Not reported"}`,
    `Recovery dispositions: ${adjudication.recovery.dispositionCounts?.join("; ") || "None reported"}`,
    ...admittedRows(adjudication.recovery.dispositions),
    `Unresolved facets: ${adjudication.gaps.join("; ") || "None reported"}`,
  ].join("\n") : "Scenario adjudication: Not received";

  const trace = input.pipelineTrace;
  const traceSummary = trace
    ? [
        `Diagnostic schema: ${trace.schemaVersion}`,
        `Request ID: ${trace.requestId}`,
        `Build commit: ${trace.buildCommit ?? "Unavailable"}`,
        "Observed server stage transitions (elapsed from request start):",
        ...trace.stageTimeline.slice(0, 32).map((stage, index, stages) => {
          const prior = index > 0 ? stages[index - 1].atMs : 0;
          return `  ${index + 1}. ${stage.key} — ${stage.label}: ${stage.atMs} ms (+${Math.max(0, stage.atMs - prior)} ms)`;
        }),
      ].join("\n")
    : "Request trace: Not received";

  const validation = input.terminalValidation;
  const validationSummary = validation
    ? [
        `Outcome: ${validation.degraded ? "Degraded/fallback" : "Completed without declared degradation"}`,
        `Fallback reason: ${validation.fallbackReason ?? "None"}`,
        `Deterministic pruning: ${publicPruneNote(validation.pruneNote) ?? "None reported"}`,
        `Authority mention rewrite: ${clientCheckNote([validation.rewriteNote]) ?? "None reported"}`,
        `Semantic claim validation: ${clientCheckNote([validation.claimValidationNote]) ?? "No unsupported claims reported"}`,
        `Invalid citations: ${validation.invalidCitations.length}`,
      ].join("\n")
    : "Terminal validation: Not received";

  return [
    "OPEN ORDER AI DEBUG SNAPSHOT",
    "============================",
    "",
    `Question: ${input.question || "None"}`,
    `Requested corpus: ${input.requestedCorpus ?? "Auto"}`,
    `Effective corpus: ${input.effectiveCorpus ?? "Auto"}`,
    `Stage: ${input.stageLabel ?? "None"}`,
    `Started at: ${input.startedAt ?? "None"}`,
    `Latency ms: ${input.latencyMs ?? "Unknown"}`,
    `Error: ${input.error ?? "None"}`,
    `Error kind: ${input.errorKind ?? "Unknown/not applicable"}`,
    `Error retryable: ${input.errorRetryable === null ? "Unknown" : input.errorRetryable ? "Yes" : "No"}`,
    "",
    "REQUEST TRACE",
    "-------------",
    traceSummary,
    "",
    "SEMANTIC AUTHORITY COVERAGE",
    "---------------------------",
    semanticSummary,
    "",
    "SCENARIO SOURCE ADJUDICATION",
    "----------------------------",
    adjudicationSummary,
    `Incident repair: ${clientCheckNote([trace?.incidentRepair]) ?? "Not attempted or not reported"}`,
    "",
    "VALIDATION OUTCOME",
    "------------------",
    validationSummary,
    "",
    "PLAN",
    "----",
    `Intent: ${input.plan?.intent ?? "None"}`,
    `Preferred corpus: ${input.plan?.preferredCorpus ?? "None"}`,
    `Notes: ${input.plan?.notes ?? "None"}`,
    "Planner search queries:",
    searchQueries,
    "",
    "Salient user terms:",
    salientTermsText,
    "",
    "Inferred concepts:",
    inferredConceptsText,
    "",
    "Expanded queries:",
    expandedQueriesText,
    "",
    "BLUEPRINT COVERAGE",
    "------------------",
    `Satisfied: ${
      input.blueprintSatisfied === null
        ? "Unknown"
        : input.blueprintSatisfied
          ? "Yes"
          : "No"
    }`,
    "Blueprint slots:",
    blueprintSlotsText,
    "",
    "Required slots:",
    requiredSlotsText,
    "",
    "Optional slots:",
    optionalSlotsText,
    "",
    "Satisfied slots:",
    satisfiedSlotsText,
    "",
    "Missing required slots:",
    missingRequiredSlotsText,
    "",
    "Selected slot matches:",
    selectedSlotMatchesText,
    "",
    "RETRIEVALS",
    "----------",
    retrievalsText,
    "",
    "FINAL AUTHORITY SELECTION",
    "-------------------------",
    finalAuthoritySelectionText,
    "",
    "AUTHORITIES",
    "-----------",
    authoritiesText,
    "",
    "ANSWER",
    "------",
    input.answerText || "None",
    "",
  ].join("\n");
}

/** Display targets for stable server stage keys. The hook owns monotonic progression. */
export function getAiProgressValue(stageKey: string | null): number {
  switch (stageKey) {
    case "planning": return 20;
    case "retrieving": return 48;
    case "selecting": return 68;
    case "answering": return 83;
    case "validating": return 94;
    default: return 12;
  }
}
