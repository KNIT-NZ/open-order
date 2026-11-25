export function updateUrlState(
  query: string,
  corpus: string,
  offset = 0,
  focus?: string | null,
) {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams();

  if (query.trim()) {
    params.set("q", query.trim());
  }

  if (corpus) {
    params.set("corpus", corpus);
  }

  if (offset > 0) {
    params.set("offset", String(offset));
  }

  if (focus) {
    params.set("focus", focus);
  }

  // Ordinary search state must not persist question text in browser URLs.
  params.delete("q");
  const next = params.toString() ? `/?${params.toString()}` : "/";
  window.history.replaceState({}, "", next);
}

export function parseInitialSearchParams() {
  if (typeof window === "undefined") {
    return {
      query: "",
      corpus: "",
      focusKey: null as string | null,
    };
  }

  const params = new URLSearchParams(window.location.search);

  return {
    query: params.get("q") ?? "",
    corpus: params.get("corpus") ?? "",
    focusKey: params.get("focus"),
  };
}