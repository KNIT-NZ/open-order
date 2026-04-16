// app/api/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { searchParamsSchema } from "@/lib/search";
import { searchProceduralAuthorities } from "@/lib/procedural-search";
import {
  buildSingularizedPhrase,
  cleanQuery,
  singularizeWord,
} from "@/lib/search-core";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildPhraseVariants(query: string): string[] {
  const cleaned = cleanQuery(query);
  if (!cleaned) return [];

  const variants = new Set<string>();
  variants.add(cleaned);

  const singularized = buildSingularizedPhrase(cleaned);
  if (singularized) {
    variants.add(singularized);
  }

  return [...variants].filter(Boolean);
}

function highlightWholePhrase(text: string, query: string): string | null {
  const variants = buildPhraseVariants(query);
  if (variants.length === 0) return null;

  let html = escapeHtml(text);
  let matched = false;

  const sortedVariants = [...variants].sort((a, b) => b.length - a.length);

  for (const variant of sortedVariants) {
    const escapedVariant = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escapedVariant}\\b`, "gi");

    if (regex.test(text)) {
      matched = true;
      html = html.replace(regex, (match) => `<mark>${match}</mark>`);
    }
  }

  return matched ? html : null;
}

function highlightSingleWords(text: string, query: string): string {
  let html = escapeHtml(text);

  const words = cleanQuery(query)
    .split(/\s+/)
    .map((word) => singularizeWord(word))
    .filter(Boolean);

  for (const word of words) {
    const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escapedWord}\\b`, "gi");
    html = html.replace(regex, (match) => `<mark>${match}</mark>`);
  }

  return html;
}

function buildTargetedHighlight(originalText: string, query: string): string {
  const isPhraseLike = cleanQuery(query).split(/\s+/).length >= 2;

  if (isPhraseLike) {
    const phraseHighlighted = highlightWholePhrase(originalText, query);
    if (phraseHighlighted) {
      return phraseHighlighted;
    }
  }

  return highlightSingleWords(originalText, query);
}

export async function GET(request: NextRequest) {
  const parsed = searchParamsSchema.safeParse({
    q: request.nextUrl.searchParams.get("q") ?? "",
    corpus: request.nextUrl.searchParams.get("corpus") ?? undefined,
    limit: request.nextUrl.searchParams.get("limit") ?? "10",
    offset: request.nextUrl.searchParams.get("offset") ?? "0",
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { q, corpus, limit, offset } = parsed.data;
  const started = Date.now();

  const response = await searchProceduralAuthorities({
    q,
    corpus: corpus ?? null,
    limit,
    offset,
    includeDebug: true,
  });

  const latencyMs = Date.now() - started;

  await db.query(
    `
    insert into query_logs (
      query_text,
      mode,
      corpus,
      top_k,
      latency_ms,
      result_count,
      metadata
    )
    values ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `,
    [
      response.query,
      "procedural_search_core_v1",
      response.corpus,
      response.limit,
      latencyMs,
      response.results.length,
      JSON.stringify({
        ...(response.debug ?? {}),
        offset: response.offset,
        total: response.total,
      }),
    ],
  );

  return NextResponse.json({
    ok: true,
    query: response.query,
    corpus: response.corpus,
    limit: response.limit,
    offset: response.offset,
    total: response.total,
    hasMore: response.hasMore,
    latencyMs,
    results: response.results.map((row) => ({
      sectionId: row.sectionId,
      sectionKey: row.sectionKey,
      citationLabel: row.citationLabel,
      heading: row.heading,
      headingHighlighted: row.heading
        ? buildTargetedHighlight(row.heading, response.query)
        : null,
      sectionContentHighlighted: buildTargetedHighlight(
        row.sectionContent,
        response.query,
      ),
      path: row.path,
      documentSlug: row.documentSlug,
      documentTitle: row.documentTitle,
      documentCorpus: row.documentCorpus,
      sourceUrl: row.sourceUrl,
      sourceAnchor: row.sourceAnchor,
      rank: row.rank,
      sectionRank: row.sectionRank,
      pathRank: row.pathRank,
      bodyRank: row.bodyRank,
      chunkRank: row.chunkRank,
      clusterSupportCount: row.clusterSupportCount,
      sectionContent: row.sectionContent,
      matchSignals: row.matchSignals,
    })),
  });
}