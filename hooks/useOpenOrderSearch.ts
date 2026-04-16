// hooks/useOpenOrderSearch.ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { corpusLabel } from "../lib/open-order/format";
import { parseInitialSearchParams, updateUrlState } from "../lib/open-order/url";
import type { SearchResponse } from "../lib/open-order/types";

const PAGE_SIZE = 10;

export function useOpenOrderSearch() {
  const [query, setQuery] = useState("");
  const [corpus, setCorpus] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [submittedCorpus, setSubmittedCorpus] = useState("");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<SearchResponse | null>(null);

  const initializedRef = useRef(false);

  const runSearch = useCallback(
    async (
      nextQuery: string,
      nextCorpus = corpus,
      nextOffset = 0,
      mode: "replace" | "append" = "replace",
      nextFocusKey: string | null = focusKey,
    ) => {
      const trimmed = nextQuery.trim();
      if (!trimmed) return;

      if (mode === "append") {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setResponse(null);
      }

      setError(null);
      setSubmittedQuery(trimmed);
      setSubmittedCorpus(nextCorpus);
      setFocusKey(nextFocusKey);

      try {
        const params = new URLSearchParams({
          q: trimmed,
          limit: String(PAGE_SIZE),
          offset: String(nextOffset),
        });

        if (nextCorpus) {
          params.set("corpus", nextCorpus);
        }

        if (nextFocusKey) {
          params.set("focus", nextFocusKey);
        }

        const res = await fetch(`/api/search?${params.toString()}`, {
          method: "GET",
        });

        const json = (await res.json()) as SearchResponse | { error?: unknown };

        if (!res.ok) {
          if (mode === "replace") {
            setResponse(null);
          }
          setError("Search failed.");
          return;
        }

        const nextResponse = json as SearchResponse;

        if (mode === "append" && response) {
          const merged = {
            ...nextResponse,
            results: [...response.results, ...nextResponse.results],
          };
          setResponse(merged);
          updateUrlState(trimmed, nextCorpus, nextOffset, nextFocusKey);
        } else {
          setResponse(nextResponse);
          updateUrlState(trimmed, nextCorpus, nextOffset, nextFocusKey);
        }
      } catch {
        if (mode === "replace") {
          setResponse(null);
        }
        setError("Search failed.");
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [corpus, focusKey, response],
  );

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const initial = parseInitialSearchParams();
    if (!initial.query) return;

    setQuery(initial.query);
    setCorpus(initial.corpus);
    setFocusKey(initial.focusKey);
    void runSearch(initial.query, initial.corpus, 0, "replace", initial.focusKey);
  }, [runSearch]);

  const hasSearched = submittedQuery.trim().length > 0;

  const summaryText = useMemo(() => {
    if (!response) return null;

    const shown = response.results.length;
    const corpusText = response.corpus
      ? ` in ${corpusLabel(response.corpus)}`
      : "";

    return `${shown} of ${response.total} result${
      response.total === 1 ? "" : "s"
    }${corpusText} · ${response.latencyMs} ms`;
  }, [response]);

  return {
    query,
    setQuery,
    corpus,
    setCorpus,
    submittedQuery,
    submittedCorpus,
    focusKey,
    setFocusKey,
    isLoading,
    isLoadingMore,
    error,
    response,
    hasSearched,
    summaryText,
    runSearch,
  };
}