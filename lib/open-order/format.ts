import type {
  AiDiagnosticTopResult,
  AiDiagnostics,
  SearchResult,
} from "./types";

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

export function formatAiDebugSnapshot(input: AiDiagnostics): string {
  const searchQueries = input.plan?.searchQueries?.length
    ? input.plan.searchQueries.map((q, i) => `${i + 1}. ${q}`).join("\n")
    : "None";

  const inferredConceptsText =
    input.inferredConcepts.length > 0
      ? input.inferredConcepts.map((c, i) => `${i + 1}. ${c}`).join("\n")
      : "None";

  const expandedQueriesText =
    input.expandedQueries.length > 0
      ? input.expandedQueries.map((q, i) => `${i + 1}. ${q}`).join("\n")
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

            return [
              `${retrievalIndex + 1}. Query: ${retrieval.query}`,
              `   Corpus: ${retrieval.corpus ?? "Auto"}`,
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
              `   baseRank: ${item.baseRank.toFixed(2)}`,
              `   routeBoost: ${item.routeBoost.toFixed(2)}`,
              `   adjustedRank: ${item.adjustedRank.toFixed(2)}`,
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
    "",
    "PLAN",
    "----",
    `Intent: ${input.plan?.intent ?? "None"}`,
    `Preferred corpus: ${input.plan?.preferredCorpus ?? "None"}`,
    `Notes: ${input.plan?.notes ?? "None"}`,
    "Planner search queries:",
    searchQueries,
    "",
    "Inferred concepts:",
    inferredConceptsText,
    "",
    "Expanded queries:",
    expandedQueriesText,
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

export function getAiProgressValue(
  stageLabel: string | null,
  isAiLoading: boolean,
) {
  if (!stageLabel && !isAiLoading) return 0;
  if (!stageLabel && isAiLoading) return 6;

  const stage = (stageLabel ?? "").toLowerCase();

  if (stage.includes("complete")) return 100;
  if (stage.includes("answer")) return 90;
  if (stage.includes("synth")) return 82;
  if (stage.includes("authorit")) return 72;
  if (stage.includes("retriev")) return 58;
  if (stage.includes("search")) return 42;
  if (stage.includes("plan")) return 22;
  if (stage.includes("start")) return 10;

  return isAiLoading ? 14 : 100;
}
