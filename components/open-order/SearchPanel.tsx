// components/open-order/SearchPanel.tsx
import styles from "./openOrder.module.css";

type SearchPanelProps = {
  query: string;
  corpus: string;
  isLoading: boolean;
  isLoadingMore: boolean;
  onQueryChange: (value: string) => void;
  onCorpusChange: (value: string) => void;
  onSubmit: () => void;
};

export function SearchPanel({
  query,
  corpus,
  isLoading,
  isLoadingMore,
  onQueryChange,
  onCorpusChange,
  onSubmit,
}: SearchPanelProps) {
  return (
    <form
      className={styles.searchForm}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className={styles.searchHeader}>
        <div className={styles.searchKicker}>Direct search</div>
        <h2 className={styles.searchTitle}>Search the texts directly</h2>
      </div>

      <div className={styles.searchStack}>
        <textarea
          className={`${styles.searchInput} ${styles.searchTextarea}`}
          placeholder="Example: SO 38A, points of order, urgency, financial veto"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          aria-label="Search query"
          rows={4}
        />

        <select
          className={styles.searchSelect}
          value={corpus}
          onChange={(event) => onCorpusChange(event.target.value)}
          aria-label="Corpus filter"
        >
          <option value="">All corpora</option>
          <option value="standing_orders">Standing Orders</option>
          <option value="speakers_rulings">Speakers’ Rulings</option>
        </select>

        <button
          className={styles.searchButton}
          type="submit"
          disabled={isLoading || isLoadingMore || !query.trim()}
        >
          {isLoading ? "Searching…" : "Search"}
        </button>
      </div>
    </form>
  );
}
