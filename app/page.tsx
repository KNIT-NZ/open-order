// app/page.tsx
"use client";

import { useState } from "react";
import type { MouseEvent } from "react";

import styles from "../components/open-order/openOrder.module.css";
import { AssistantPanel } from "../components/open-order/AssistantPanel";
import { Footer } from "../components/open-order/Footer";
import { Hero } from "../components/open-order/Hero";
import { ResultsList } from "../components/open-order/ResultsList";
import { SearchPanel } from "../components/open-order/SearchPanel";
import { useOpenOrderAssistant } from "../hooks/useOpenOrderAssistant";
import { useOpenOrderSearch } from "../hooks/useOpenOrderSearch";
import { useOpenOrderTheme } from "../hooks/useOpenOrderTheme";

export default function Page() {
  const { theme, toggleTheme } = useOpenOrderTheme();
  const search = useOpenOrderSearch();
  const assistant = useOpenOrderAssistant();
  const [citationNavigationSerial, setCitationNavigationSerial] = useState(0);

  // Internal canonical authority links are useful as shareable deep links, but
  // following them inside the active assistant must not replace the page.
  function handleCitationClick(event: MouseEvent<HTMLElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      !(event.target instanceof Element)
    ) {
      return;
    }

    const anchor = event.target.closest("a[href]");
    if (!anchor || anchor.hasAttribute("download")) return;
    const target = anchor.getAttribute("target")?.toLowerCase();
    if (target && target !== "_self") return;

    const href = anchor.getAttribute("href");
    if (!href) return;

    let destination: URL;
    try {
      destination = new URL(href, window.location.href);
    } catch {
      return;
    }

    if (
      destination.origin !== window.location.origin ||
      destination.pathname !== window.location.pathname ||
      destination.hash
    ) {
      return;
    }

    const params = destination.searchParams;
    const citation = params.get("q");
    const corpus = params.get("corpus");
    const focus = params.get("focus");
    if (
      !citation?.trim() ||
      !focus?.trim() ||
      (corpus !== "standing_orders" && corpus !== "speakers_rulings") ||
      params.getAll("q").length !== 1 ||
      params.getAll("corpus").length !== 1 ||
      params.getAll("focus").length !== 1
    ) {
      return;
    }

    // Search by citation using the existing search hook; do not navigate,
    // replace URL state or remount the assistant conversation/trace.
    event.preventDefault();
    const requestedCorpus = corpus as typeof search.corpus;
    search.setQuery(citation);
    search.setCorpus(requestedCorpus);
    setCitationNavigationSerial((serial) => serial + 1);
    void search.runSearch(citation, requestedCorpus, 0, "replace", focus);
  }

  return (
    <main className={styles.shell} onClickCapture={handleCitationClick}>
      <section className={styles.hero}>
        <Hero theme={theme} onToggleTheme={toggleTheme} />

        <div className={styles.controlGrid}>
          <section className={styles.controlPrimary}>
            <AssistantPanel
              assistant={assistant}
              corpus={search.corpus}
              currentSearchQuery={search.query}
            />
          </section>

          <aside className={styles.controlSecondary}>
            <SearchPanel
              query={search.query}
              corpus={search.corpus}
              isLoading={search.isLoading}
              isLoadingMore={search.isLoadingMore}
              onQueryChange={search.setQuery}
              onCorpusChange={search.setCorpus}
              onSubmit={() =>
                void search.runSearch(search.query, search.corpus, 0, "replace", null)
              }
            />
          </aside>
        </div>
      </section>

      <ResultsList
        response={search.response}
        error={search.error}
        hasSearched={search.hasSearched}
        isLoading={search.isLoading}
        isLoadingMore={search.isLoadingMore}
        summaryText={search.summaryText}
        focusKey={search.focusKey}
        citationNavigationSerial={citationNavigationSerial}
        submittedQuery={search.submittedQuery}
        submittedCorpus={search.submittedCorpus}
        onLoadMore={(offset) =>
          void search.runSearch(
            search.submittedQuery,
            search.submittedCorpus,
            offset,
            "append",
            search.focusKey,
          )
        }
      />

      <Footer />
    </main>
  );
}