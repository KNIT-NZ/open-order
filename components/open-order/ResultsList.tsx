"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./openOrder.module.css";
import {
  buildCanonicalCitationHref,
  buildFormattedSectionHtml,
  buildSourceHref,
  copyText,
  corpusLabel,
  escapeHtml,
  resultReason,
} from "../../lib/open-order/format";
import type { SearchResponse } from "../../lib/open-order/types";

type ResultsListProps = {
  response: SearchResponse | null;
  error: string | null;
  hasSearched: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  summaryText: string | null;
  focusKey: string | null;
  submittedQuery: string;
  submittedCorpus: string;
  onLoadMore: (offset: number) => void;
};

export function ResultsList({
  response,
  error,
  hasSearched,
  isLoading,
  isLoadingMore,
  summaryText,
  focusKey,
  submittedQuery,
  submittedCorpus,
  onLoadMore,
}: ResultsListProps) {
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [activeFlashKey, setActiveFlashKey] = useState<string | null>(null);
  const [dismissedDrawerSignature, setDismissedDrawerSignature] = useState<
    string | null
  >(null);

  const focusedElementMapRef = useRef<Record<string, HTMLLIElement | null>>({});
  const focusAttemptedRef = useRef(false);

  const hasDrawerContent = useMemo(() => {
    return Boolean(
      error ||
      isLoading ||
      hasSearched ||
      (response && response.results.length > 0),
    );
  }, [error, isLoading, hasSearched, response]);

  const resultCount = response?.results.length ?? 0;

  const drawerSignature = useMemo(() => {
    return JSON.stringify({
      submittedQuery,
      submittedCorpus,
      resultCount,
      hasError: Boolean(error),
      isLoading,
    });
  }, [submittedQuery, submittedCorpus, resultCount, error, isLoading]);

  const isDrawerOpen =
    hasDrawerContent && dismissedDrawerSignature !== drawerSignature;

  useEffect(() => {
    if (!copiedToken) return;

    const timeout = window.setTimeout(() => {
      setCopiedToken(null);
    }, 1600);

    return () => window.clearTimeout(timeout);
  }, [copiedToken]);

  useEffect(() => {
    if (!focusKey || !response || response.results.length === 0) return;
    if (focusAttemptedRef.current) return;

    const focusedResult = response.results.find(
      (result) =>
        result.sectionKey === focusKey ||
        result.citationLabel === focusKey ||
        result.sectionId === focusKey,
    );

    if (!focusedResult) {
      if (response.hasMore && !isLoadingMore && submittedQuery.trim()) {
        focusAttemptedRef.current = true;
        onLoadMore(response.results.length);
        window.setTimeout(() => {
          focusAttemptedRef.current = false;
        }, 300);
      }
      return;
    }

    const element = focusedElementMapRef.current[focusedResult.sectionId];
    if (!element) return;

    focusAttemptedRef.current = true;

    window.requestAnimationFrame(() => {
      element.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      setActiveFlashKey(focusedResult.sectionId);

      window.setTimeout(() => {
        setActiveFlashKey((current) =>
          current === focusedResult.sectionId ? null : current,
        );
        focusAttemptedRef.current = false;
      }, 2200);
    });
  }, [
    focusKey,
    response,
    isLoadingMore,
    submittedQuery,
    submittedCorpus,
    onLoadMore,
  ]);

  if (!hasDrawerContent) {
    return null;
  }

  return (
    <>
      {isDrawerOpen ? (
        <button
          type="button"
          className={styles.resultsDrawerOverlay}
          aria-label="Close search results drawer"
          onClick={() => setDismissedDrawerSignature(drawerSignature)}
        />
      ) : null}

      <button
        type="button"
        className={`${styles.resultsDrawerToggle} ${
          isDrawerOpen ? styles.resultsDrawerToggleOpen : ""
        }`}
        onClick={() => {
          if (isDrawerOpen) {
            setDismissedDrawerSignature(drawerSignature);
          } else {
            setDismissedDrawerSignature(null);
          }
        }}
        aria-expanded={isDrawerOpen}
        aria-controls="open-order-results-drawer"
        aria-label={
          isDrawerOpen ? "Hide search results" : "Show search results"
        }
        title={isDrawerOpen ? "Hide search results" : "Show search results"}
      >
        <svg
          className={`${styles.resultsDrawerChevron} ${
            isDrawerOpen ? styles.resultsDrawerChevronOpen : ""
          }`}
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path
            d="M7 4.5L12.5 10L7 15.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <aside
        id="open-order-results-drawer"
        className={`${styles.resultsDrawer} ${
          isDrawerOpen ? styles.resultsDrawerOpen : styles.resultsDrawerClosed
        }`}
        aria-hidden={!isDrawerOpen}
      >
        <div className={styles.resultsDrawerHeader}>
          <div className={styles.resultsDrawerHeaderText}>
            <div className={styles.searchKicker}>Direct search results</div>
            <h2 className={styles.searchTitle}>Search drawer</h2>
          </div>

          <button
            type="button"
            className={styles.resultsDrawerClose}
            onClick={() => setDismissedDrawerSignature(drawerSignature)}
            aria-label="Collapse search results drawer"
          >
            ×
          </button>
        </div>

        <div className={styles.resultsDrawerBody}>
          {error ? <div className={styles.error}>{error}</div> : null}

          {hasSearched && !isLoading && summaryText ? (
            <div className={styles.summary}>{summaryText}</div>
          ) : null}

          {hasSearched &&
          !isLoading &&
          response &&
          response.results.length === 0 ? (
            <div className={styles.empty}>
              No results found. Try a broader term, or search by citation like{" "}
              <code>SO 112</code>.
            </div>
          ) : null}

          {response?.results?.length ? (
            <>
              <ol className={styles.resultsList}>
                {response.results.map((result) => {
                  const sourceHref = buildSourceHref(result);
                  const canonicalCitationHref = buildCanonicalCitationHref(
                    result.citationLabel,
                    result.documentCorpus,
                    result.sectionKey,
                  );
                  const formattedSectionHtml =
                    buildFormattedSectionHtml(result);
                  const citationCopyToken = `${result.sectionId}:citation`;
                  const sourceCopyToken = `${result.sectionId}:source`;
                  const isCitationCopied = copiedToken === citationCopyToken;
                  const isSourceCopied = copiedToken === sourceCopyToken;
                  const isFocused = activeFlashKey === result.sectionId;

                  const corpusClass =
                    result.documentCorpus === "standing_orders"
                      ? styles.corpusTabStandingOrders
                      : result.documentCorpus === "speakers_rulings"
                        ? styles.corpusTabSpeakersRulings
                        : "";

                  return (
                    <li
                      key={result.sectionId}
                      ref={(node) => {
                        focusedElementMapRef.current[result.sectionId] = node;
                      }}
                      className={`${styles.resultCard} ${
                        isFocused ? styles.resultCardFocused : ""
                      }`}
                    >
                      <div className={`${styles.corpusTab} ${corpusClass}`}>
                        {corpusLabel(result.documentCorpus)}
                      </div>

                      <div className={styles.resultTop}>
                        <div className={styles.resultIdentity}>
                          <div className={styles.citationRow}>
                            <a
                              className={styles.citation}
                              href={canonicalCitationHref}
                            >
                              {result.citationLabel}
                            </a>
                            {result.heading ? (
                              <span
                                className={styles.heading}
                                dangerouslySetInnerHTML={{
                                  __html:
                                    result.headingHighlighted ||
                                    escapeHtml(result.heading),
                                }}
                              />
                            ) : null}
                          </div>

                          <div className={styles.path}>
                            {result.path.map((part, pathIndex) => (
                              <span
                                key={`${result.sectionId}-path-${pathIndex}`}
                              >
                                {pathIndex > 0 ? (
                                  <span className={styles.pathSep}>›</span>
                                ) : null}
                                <span>{part}</span>
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className={styles.cardActions}>
                          {sourceHref ? (
                            <a
                              className={styles.linkAction}
                              href={sourceHref}
                              target="_blank"
                              rel="noreferrer"
                              title="Open authoritative source. Alt/Option-click to copy the deep source link."
                              onClick={(event) => {
                                if (!event.altKey) return;

                                event.preventDefault();

                                void copyText(sourceHref).then((ok) => {
                                  if (ok) {
                                    setCopiedToken(sourceCopyToken);
                                  }
                                });
                              }}
                            >
                              {isSourceCopied ? "Source copied" : "Source"}
                            </a>
                          ) : null}

                          <button
                            type="button"
                            className={`${styles.linkAction} ${styles.linkActionButton}`}
                            onClick={() => {
                              const absoluteUrl =
                                typeof window !== "undefined"
                                  ? new URL(
                                      canonicalCitationHref,
                                      window.location.origin,
                                    ).toString()
                                  : canonicalCitationHref;

                              void copyText(absoluteUrl).then((ok) => {
                                if (ok) {
                                  setCopiedToken(citationCopyToken);
                                }
                              });
                            }}
                            title="Copy canonical Open Order citation link"
                          >
                            {isCitationCopied ? "Copied" : "Copy citation"}
                          </button>
                        </div>
                      </div>

                      <div className={styles.sectionCard}>
                        <div className={styles.sectionCardHeader}>
                          <div className={styles.sectionCardLabel}>
                            Section text
                          </div>
                        </div>

                        <div
                          className={styles.sectionBody}
                          dangerouslySetInnerHTML={{
                            __html: formattedSectionHtml,
                          }}
                        />
                      </div>

                      <div className={styles.resultFooter}>
                        <div className={styles.ranks}>
                          <span className={styles.rankLabel}>
                            Rank {result.rank.toFixed(2)}
                          </span>
                          <span className={styles.rankMeta}>
                            section {result.sectionRank.toFixed(2)}
                            {result.chunkRank !== null
                              ? ` · chunk ${result.chunkRank.toFixed(2)}`
                              : ""}
                            {` · ${resultReason(result)}`}
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>

              {response.hasMore ? (
                <div className={styles.loadMoreWrap}>
                  <button
                    type="button"
                    className={styles.loadMoreButton}
                    disabled={isLoadingMore}
                    onClick={() => onLoadMore(response.results.length)}
                  >
                    {isLoadingMore ? "Loading…" : "Load more"}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </aside>
    </>
  );
}
