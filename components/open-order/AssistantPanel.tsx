// components/open-order/AssistantPanel.tsx
"use client";

import styles from "./openOrder.module.css";
import {
  buildCanonicalCitationHref,
  copyText,
  corpusLabel,
  getAiProgressValue,
  renderAiAnswerHtml,
} from "../../lib/open-order/format";
import type {
  ThemeMode,
  UseOpenOrderAssistantReturn,
} from "../../lib/open-order/types";

type AssistantPanelProps = {
  assistant: UseOpenOrderAssistantReturn;
  corpus: string;
  currentSearchQuery: string;
};

function corpusTabClassName(documentCorpus: string) {
  if (documentCorpus === "standing_orders") {
    return `${styles.corpusTab} ${styles.corpusTabStandingOrders}`;
  }

  if (documentCorpus === "speakers_rulings") {
    return `${styles.corpusTab} ${styles.corpusTabSpeakersRulings}`;
  }

  return styles.corpusTab;
}

export function AssistantPanel({
  assistant,
  corpus,
  currentSearchQuery,
}: AssistantPanelProps) {
  const aiAnswerHtml = assistant.answerText.trim()
    ? renderAiAnswerHtml(assistant.answerText)
    : null;

  const hasAiTrace = Boolean(
    assistant.plan ||
    assistant.diagnostics.retrievals.length > 0 ||
    assistant.authorities.length > 0 ||
    assistant.diagnostics.inferredConcepts.length > 0 ||
    assistant.diagnostics.expandedQueries.length > 0 ||
    assistant.diagnostics.finalAuthoritySelection.length > 0 ||
    assistant.diagnostics.latencyMs !== null,
  );

  const aiProgressValue = getAiProgressValue(
    assistant.stageLabel,
    assistant.isLoading,
  );

  const displayedProgressValue =
    assistant.isLoading && assistant.stageLabel
      ? Math.max(aiProgressValue, 12)
      : aiProgressValue;

  return (
    <div className={styles.panel}>
      <div className={styles.aiPanelHeader}>
        <div>
          <div className={styles.aiKicker}>Procedural Assistant</div>
          <h2 className={styles.aiTitle}>
            Ask what is going on, or what your options are
          </h2>
        </div>
      </div>

      <div className={styles.aiControls}>
        <textarea
          className={styles.aiTextarea}
          value={assistant.question}
          onChange={(event) => assistant.setQuestion(event.target.value)}
          placeholder="Example: A member has just raised a point of order saying the speech is irrelevant. What is that all about, and what are the options for the Chair and the member speaking?"
          aria-label="Ask the procedural assistant"
          rows={5}
        />

        <div className={styles.aiActions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void assistant.ask(corpus || null)}
            disabled={assistant.isLoading || !assistant.question.trim()}
          >
            {assistant.isLoading ? "Thinking…" : "Ask Assistant"}
          </button>

          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              void copyText(assistant.debugSnapshot).then((ok) => {
                if (ok) assistant.setCopiedToken("ai-debug-snapshot");
              });
            }}
            disabled={assistant.isLoading || !assistant.hasDebugSnapshot}
          >
            {assistant.copiedToken === "ai-debug-snapshot"
              ? "Debug copied"
              : "Copy debug snapshot"}
          </button>
        </div>
      </div>

      {(assistant.isLoading || assistant.stageLabel) && !assistant.error ? (
        <div className={styles.aiProgressCard} aria-live="polite">
          <div className={styles.aiProgressMeta}>
            <span className={styles.aiProgressLabel}>Processing</span>
            <span className={styles.aiProgressValue}>
              {Math.round(displayedProgressValue)}%
            </span>
          </div>
          <div className={styles.aiProgressTrack} aria-hidden="true">
            <div
              className={`${styles.aiProgressBar} ${
                assistant.isLoading ? styles.aiProgressBarActive : ""
              }`}
              style={{ width: `${displayedProgressValue}%` }}
            />
          </div>
          {assistant.stageLabel ? (
            <div className={styles.aiStageSubtle}>{assistant.stageLabel}</div>
          ) : null}
        </div>
      ) : null}

      {assistant.error ? (
        <div className={styles.error}>{assistant.error}</div>
      ) : null}

      {aiAnswerHtml ? (
        <div className={styles.aiAnswerCard}>
          <div className={styles.aiAnswerLabel}>Answer</div>
          <div
            className={styles.aiAnswerBody}
            dangerouslySetInnerHTML={{ __html: aiAnswerHtml }}
          />
        </div>
      ) : null}

      {hasAiTrace ? (
        <details className={styles.aiTrace}>
          <summary className={styles.aiTraceSummary}>
            <span>Thinking trace</span>
            <span className={styles.aiTraceHint}>
              plan, diagnostics, authorities
            </span>
          </summary>

          <div className={styles.aiTraceBody}>
            {assistant.plan ? (
              <div className={styles.aiPlan}>
                <div className={styles.aiPlanLabel}>Retrieval plan</div>
                <div className={styles.aiPlanMeta}>
                  <span>Intent: {assistant.plan.intent}</span>
                  <span>
                    Corpus:{" "}
                    {assistant.plan.preferredCorpus
                      ? corpusLabel(assistant.plan.preferredCorpus)
                      : "Auto"}
                  </span>
                </div>
                <div className={styles.aiPlanQueries}>
                  {assistant.plan.searchQueries.map((item) => (
                    <span key={item} className={styles.aiPlanChip}>
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {assistant.diagnostics.retrievals.length > 0 ? (
              <div className={styles.aiPlan}>
                <div className={styles.aiPlanLabel}>Retrieval diagnostics</div>

                <div className={styles.aiPlanMeta}>
                  <span>
                    Effective corpus:{" "}
                    {assistant.diagnostics.effectiveCorpus
                      ? corpusLabel(assistant.diagnostics.effectiveCorpus)
                      : "Auto"}
                  </span>
                  <span>
                    Concepts: {assistant.diagnostics.inferredConcepts.length}
                  </span>
                  <span>
                    Expanded queries:{" "}
                    {assistant.diagnostics.expandedQueries.length}
                  </span>
                  <span>
                    Final authorities:{" "}
                    {assistant.diagnostics.finalAuthoritySelection.length}
                  </span>
                  <span>
                    Latency:{" "}
                    {assistant.diagnostics.latencyMs !== null
                      ? `${assistant.diagnostics.latencyMs} ms`
                      : "Pending"}
                  </span>
                </div>

                {assistant.diagnostics.inferredConcepts.length > 0 ? (
                  <div className={styles.aiPlanQueries}>
                    {assistant.diagnostics.inferredConcepts.map((item) => (
                      <span
                        key={`concept-${item}`}
                        className={styles.aiPlanChip}
                      >
                        concept: {item}
                      </span>
                    ))}
                  </div>
                ) : null}

                {assistant.diagnostics.expandedQueries.length > 0 ? (
                  <div className={styles.aiPlanQueries}>
                    {assistant.diagnostics.expandedQueries.map((item) => (
                      <span key={item} className={styles.aiPlanChip}>
                        {item}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className={styles.aiAuthoritiesList}>
                  {assistant.diagnostics.retrievals.map(
                    (retrieval, retrievalIndex) => (
                      <div
                        key={`${retrieval.query}-${retrievalIndex}`}
                        className={styles.aiAuthorityCard}
                      >
                        <div className={styles.aiAuthorityContent}>
                          <div className={styles.aiAuthorityCitationRow}>
                            <span className={styles.aiAuthorityCitation}>
                              Query {retrievalIndex + 1}
                            </span>
                            <span className={styles.aiAuthorityHeading}>
                              {retrieval.query}
                            </span>
                          </div>

                          <div className={styles.aiAuthorityPath}>
                            {retrieval.resultCount} result
                            {retrieval.resultCount === 1 ? "" : "s"} · corpus{" "}
                            {retrieval.corpus
                              ? corpusLabel(retrieval.corpus)
                              : "Auto"}
                          </div>

                          {retrieval.topResults.length > 0 ? (
                            <div
                              className={styles.aiAuthorityPath}
                              style={{ marginTop: 8 }}
                            >
                              {retrieval.topResults
                                .map((result) => {
                                  const pieces = [
                                    result.citationLabel,
                                    result.heading ?? null,
                                    `rank ${result.rank.toFixed(2)}`,
                                  ].filter(Boolean);

                                  return pieces.join(" · ");
                                })
                                .join(" | ")}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            ) : null}

            {assistant.authorities.length > 0 ? (
              <div className={styles.aiAuthorities}>
                <div className={styles.aiAuthoritiesLabel}>
                  Authorities used
                </div>
                <div className={styles.aiAuthoritiesList}>
                  {assistant.authorities.map((authority) => {
                    const canonicalHref =
                      authority.canonicalHref ??
                      buildCanonicalCitationHref(
                        authority.citationLabel,
                        authority.documentCorpus,
                        authority.sectionKey,
                      );

                    return (
                      <div
                        key={authority.sectionId}
                        className={styles.aiAuthorityCard}
                      >
                        <div
                          className={corpusTabClassName(
                            authority.documentCorpus,
                          )}
                        >
                          {corpusLabel(authority.documentCorpus)}
                        </div>

                        <div className={styles.aiAuthorityContent}>
                          <div className={styles.aiAuthorityCitationRow}>
                            <a
                              className={styles.aiAuthorityCitation}
                              href={canonicalHref}
                            >
                              {authority.citationLabel}
                            </a>
                            {authority.heading ? (
                              <span className={styles.aiAuthorityHeading}>
                                {authority.heading}
                              </span>
                            ) : null}
                          </div>

                          <div className={styles.aiAuthorityPath}>
                            {authority.path.join(" › ")}
                          </div>
                        </div>

                        <div className={styles.aiAuthorityActions}>
                          {authority.sourceHref ? (
                            <a
                              className={styles.linkAction}
                              href={authority.sourceHref}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Source
                            </a>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
