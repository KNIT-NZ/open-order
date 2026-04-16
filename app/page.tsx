// app/page.tsx
"use client";

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

  return (
    <main className={styles.shell}>
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

      <Footer theme={theme} />
    </main>
  );
}