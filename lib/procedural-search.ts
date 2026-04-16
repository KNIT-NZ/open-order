// lib/procedural-search.ts
import { db } from "@/lib/db";
import {
  buildSingularizedPhrase,
  cleanQuery,
  deriveExactCitationCompact,
  deriveExactSectionKey,
} from "@/lib/search-core";

export type ProceduralSearchParams = {
  q: string;
  corpus?: string | null;
  limit?: number;
  offset?: number;
  includeDebug?: boolean;
};

export type ProceduralSearchResult = {
  sectionId: string;
  sectionKey: string;
  citationLabel: string;
  heading: string | null;
  path: string[];
  pathText: string;
  documentSlug: string;
  documentTitle: string;
  documentCorpus: string;
  sourceUrl: string | null;
  sourceAnchor: string | null;
  rank: number;
  sectionRank: number;
  pathRank: number;
  bodyRank: number;
  chunkRank: number | null;
  clusterSupportCount: number;
  sectionContent: string;
  matchSignals: {
    exactSectionKeyMatch: boolean;
    exactCitationMatch: boolean;
    exactHeadingMatch: boolean;
    headingPhraseMatch: boolean;
    bodyPhraseMatch: boolean;
    pathPhraseMatch: boolean;
  };
};

export type ProceduralSearchDebug = {
  tsQuery: string;
  phraseQuery: string;
  singularPhrase: string | null;
  singularPhraseQuery: string | null;
  queryLower: string;
  exactSectionKey: string | null;
  exactCitationCompact: string | null;
  offset: number;
  total: number;
};

export type ProceduralSearchResponse = {
  query: string;
  corpus: string | null;
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
  results: ProceduralSearchResult[];
  debug?: ProceduralSearchDebug;
};

export async function searchProceduralAuthorities(
  params: ProceduralSearchParams,
): Promise<ProceduralSearchResponse> {
  const normalizedQuery = cleanQuery(params.q);
  const corpus = params.corpus ?? null;
  const limit = Math.max(1, Math.min(params.limit ?? 8, 50));
  const offset = Math.max(0, params.offset ?? 0);
  const singularizedPhrase = buildSingularizedPhrase(normalizedQuery);
  const exactSectionKey = deriveExactSectionKey(normalizedQuery);
  const exactCitationCompact = deriveExactCitationCompact(normalizedQuery);

  const tsQueryResult = await db.query<{
    ts_query: string;
    phrase_query: string;
    singular_phrase_query: string | null;
  }>(
    `
    select
      websearch_to_tsquery('english', $1)::text as ts_query,
      phraseto_tsquery('english', $1)::text as phrase_query,
      case
        when $2::text is not null and btrim($2::text) <> ''
        then phraseto_tsquery('english', $2)::text
        else null
      end as singular_phrase_query
    `,
    [normalizedQuery, singularizedPhrase],
  );

  const tsQuery = tsQueryResult.rows[0]?.ts_query ?? "";
  const phraseQuery = tsQueryResult.rows[0]?.phrase_query ?? "";
  const singularPhraseQuery =
    tsQueryResult.rows[0]?.singular_phrase_query ?? null;

  const result = await db.query<{
    section_id: string;
    section_key: string;
    citation_label: string;
    heading: string | null;
    section_content: string;
    path: string[];
    path_text: string;
    document_slug: string;
    document_title: string;
    document_corpus: string;
    source_url: string | null;
    source_anchor: string | null;
    section_rank: number;
    heading_phrase_rank: number;
    body_phrase_rank: number;
    path_phrase_rank: number;
    chunk_rank: number | null;
    chunk_phrase_rank: number | null;
    cluster_support_count: number;
    overall_rank: number;
    total_count: number;
    exact_section_key_match: boolean;
    exact_citation_match: boolean;
    exact_heading_match: boolean;
    heading_phrase_match: boolean;
    body_phrase_match: boolean;
    path_phrase_match: boolean;
  }>(
    `
    with input as (
      select
        websearch_to_tsquery('english', $1) as ts_query,
        phraseto_tsquery('english', $1) as phrase_ts_query,
        case
          when $2::text is not null and btrim($2::text) <> ''
          then phraseto_tsquery('english', $2)
          else null
        end as singular_phrase_ts_query,
        $3::text as corpus_filter,
        $4::int as result_limit,
        $5::int as result_offset,
        $6::text as exact_section_key,
        $7::text as exact_citation_compact,
        lower(trim($1)) as query_lower,
        cardinality(regexp_split_to_array(lower(trim($1)), E'\\s+')) as query_word_count
    ),

    section_candidates as (
      select
        s.id as section_id,
        s.section_key,
        s.citation_label,
        s.heading,
        s.content as section_content,
        s.path,
        array_to_string(s.path, ' > ') as path_text,
        d.slug as document_slug,
        d.title as document_title,
        d.corpus as document_corpus,
        s.source_url,
        s.source_anchor,

        case
          when array_length(s.path, 1) is null then d.slug
          when array_length(s.path, 1) <= 3 then array_to_string(s.path, ' > ')
          else array_to_string(s.path[1:(array_length(s.path, 1) - 2)], ' > ')
        end as cluster_key,

        case
          when i.ts_query::text <> '' then ts_rank_cd(s.search_tsv, i.ts_query)
          else 0
        end as section_rank,

        case
          when i.phrase_ts_query::text <> ''
            and s.heading is not null
            and to_tsvector('english', s.heading) @@ i.phrase_ts_query
          then ts_rank_cd(to_tsvector('english', s.heading), i.phrase_ts_query)
          else 0
        end as heading_phrase_rank_primary,

        case
          when i.singular_phrase_ts_query is not null
            and s.heading is not null
            and to_tsvector('english', s.heading) @@ i.singular_phrase_ts_query
          then ts_rank_cd(to_tsvector('english', s.heading), i.singular_phrase_ts_query)
          else 0
        end as heading_phrase_rank_singular,

        case
          when i.phrase_ts_query::text <> ''
            and to_tsvector('english', s.content) @@ i.phrase_ts_query
          then ts_rank_cd(to_tsvector('english', s.content), i.phrase_ts_query)
          else 0
        end as body_phrase_rank_primary,

        case
          when i.singular_phrase_ts_query is not null
            and to_tsvector('english', s.content) @@ i.singular_phrase_ts_query
          then ts_rank_cd(to_tsvector('english', s.content), i.singular_phrase_ts_query)
          else 0
        end as body_phrase_rank_singular,

        case
          when i.phrase_ts_query::text <> ''
            and to_tsvector('english', array_to_string(s.path, ' ')) @@ i.phrase_ts_query
          then ts_rank_cd(to_tsvector('english', array_to_string(s.path, ' ')), i.phrase_ts_query)
          else 0
        end as path_phrase_rank_primary,

        case
          when i.singular_phrase_ts_query is not null
            and to_tsvector('english', array_to_string(s.path, ' ')) @@ i.singular_phrase_ts_query
          then ts_rank_cd(to_tsvector('english', array_to_string(s.path, ' ')), i.singular_phrase_ts_query)
          else 0
        end as path_phrase_rank_singular,

        case
          when i.exact_section_key is not null
            and lower(s.section_key) = i.exact_section_key
          then true else false
        end as exact_section_key_match,

        case
          when i.exact_citation_compact is not null
            and lower(regexp_replace(s.citation_label, '\\s+', '', 'g')) = i.exact_citation_compact
          then true else false
        end as exact_citation_match,

        case
          when i.query_lower <> ''
            and lower(coalesce(s.heading, '')) = i.query_lower
          then true else false
        end as exact_heading_match,

        case
          when i.query_lower <> ''
            and lower(coalesce(s.heading, '')) like '%' || i.query_lower || '%'
          then true else false
        end as heading_phrase_match,

        case
          when i.query_lower <> ''
            and i.query_word_count = 1
            and lower(s.content) like '%' || i.query_lower || '%'
          then true else false
        end as body_phrase_match,

        case
          when i.query_lower <> ''
            and lower(array_to_string(s.path, ' > ')) like '%' || i.query_lower || '%'
          then true else false
        end as path_phrase_match

      from sections s
      join documents d on d.id = s.document_id
      cross join input i
      where (
        (i.ts_query::text <> '' and s.search_tsv @@ i.ts_query)
        or (
          i.exact_section_key is not null
          and lower(s.section_key) = i.exact_section_key
        )
        or (
          i.exact_citation_compact is not null
          and lower(regexp_replace(s.citation_label, '\\s+', '', 'g')) = i.exact_citation_compact
        )
        or (
          i.query_lower <> ''
          and lower(coalesce(s.heading, '')) = i.query_lower
        )
        or (
          i.query_lower <> ''
          and lower(coalesce(s.heading, '')) like '%' || i.query_lower || '%'
        )
        or (
          i.query_word_count = 1
          and i.query_lower <> ''
          and lower(s.content) like '%' || i.query_lower || '%'
        )
        or (
          i.query_lower <> ''
          and lower(array_to_string(s.path, ' > ')) like '%' || i.query_lower || '%'
        )
      )
      and (i.corpus_filter is null or d.corpus = i.corpus_filter)
    ),

    section_scored as (
      select
        sc.section_id,
        sc.section_key,
        sc.citation_label,
        sc.heading,
        sc.section_content,
        sc.path,
        sc.path_text,
        sc.document_slug,
        sc.document_title,
        sc.document_corpus,
        sc.source_url,
        sc.source_anchor,
        sc.cluster_key,
        sc.section_rank,
        greatest(sc.heading_phrase_rank_primary, sc.heading_phrase_rank_singular) as heading_phrase_rank,
        greatest(sc.body_phrase_rank_primary, sc.body_phrase_rank_singular) as body_phrase_rank,
        greatest(sc.path_phrase_rank_primary, sc.path_phrase_rank_singular) as path_phrase_rank,
        sc.exact_section_key_match,
        sc.exact_citation_match,
        sc.exact_heading_match,
        sc.heading_phrase_match,
        sc.body_phrase_match,
        sc.path_phrase_match
      from section_candidates sc
    ),

    section_clustered as (
      select
        ss.*,
        count(*) filter (
          where
            ss.exact_heading_match
            or ss.heading_phrase_match
            or ss.heading_phrase_rank > 0
            or ss.body_phrase_rank > 0
            or ss.path_phrase_rank > 0
            or ss.path_phrase_match
        ) over (
          partition by ss.document_slug, ss.cluster_key
        ) as cluster_support_count
      from section_scored ss
    ),

    ranked as (
      select
        sc.section_id,
        sc.section_key,
        sc.citation_label,
        sc.heading,
        sc.section_content,
        sc.path,
        sc.path_text,
        sc.document_slug,
        sc.document_title,
        sc.document_corpus,
        sc.source_url,
        sc.source_anchor,
        sc.section_rank,
        sc.heading_phrase_rank,
        sc.body_phrase_rank,
        sc.path_phrase_rank,
        sc.cluster_support_count,
        bc.chunk_rank,
        bc.chunk_phrase_rank,
        sc.exact_section_key_match,
        sc.exact_citation_match,
        sc.exact_heading_match,
        sc.heading_phrase_match,
        sc.body_phrase_match,
        sc.path_phrase_match,

        (
          case when sc.exact_section_key_match then 1200 else 0 end +
          case when sc.exact_citation_match then 1100 else 0 end +
          case when sc.exact_heading_match then 240 else 0 end +
          case when sc.heading_phrase_match then 80 else 0 end +
          case when sc.path_phrase_match then 70 else 0 end +
          case when sc.body_phrase_match then 2 else 0 end +
          (sc.heading_phrase_rank * 650) +
          (sc.path_phrase_rank * 280) +
          (sc.body_phrase_rank * 110) +
          (coalesce(bc.chunk_phrase_rank, 0) * 70) +
          (sc.section_rank * 55) +
          (coalesce(bc.chunk_rank, 0) * 10) +
          case
            when sc.cluster_support_count >= 2
            then least((sc.cluster_support_count - 1) * 45, 135)
            else 0
          end
        ) as overall_rank

      from section_clustered sc
      cross join input i
      left join lateral (
        select
          case
            when i.ts_query::text <> '' then ts_rank_cd(c.search_tsv, i.ts_query)
            else 0
          end as chunk_rank,

          greatest(
            case
              when i.phrase_ts_query::text <> ''
                and c.search_tsv @@ i.phrase_ts_query
              then ts_rank_cd(c.search_tsv, i.phrase_ts_query)
              else 0
            end,
            case
              when i.singular_phrase_ts_query is not null
                and c.search_tsv @@ i.singular_phrase_ts_query
              then ts_rank_cd(c.search_tsv, i.singular_phrase_ts_query)
              else 0
            end
          ) as chunk_phrase_rank
        from chunks c
        where c.section_id = sc.section_id
        order by
          greatest(
            case
              when i.phrase_ts_query::text <> ''
                and c.search_tsv @@ i.phrase_ts_query
              then ts_rank_cd(c.search_tsv, i.phrase_ts_query)
              else 0
            end,
            case
              when i.singular_phrase_ts_query is not null
                and c.search_tsv @@ i.singular_phrase_ts_query
              then ts_rank_cd(c.search_tsv, i.singular_phrase_ts_query)
              else 0
            end
          ) desc,
          case
            when i.ts_query::text <> '' then ts_rank_cd(c.search_tsv, i.ts_query)
            else 0
          end desc,
          c.chunk_index asc
        limit 1
      ) bc on true
    ),

    counted as (
      select
        r.*,
        count(*) over() as total_count
      from ranked r
    )

    select
      section_id,
      section_key,
      citation_label,
      heading,
      section_content,
      path,
      path_text,
      document_slug,
      document_title,
      document_corpus,
      source_url,
      source_anchor,
      section_rank,
      heading_phrase_rank,
      body_phrase_rank,
      path_phrase_rank,
      chunk_rank,
      chunk_phrase_rank,
      cluster_support_count,
      overall_rank,
      total_count,
      exact_section_key_match,
      exact_citation_match,
      exact_heading_match,
      heading_phrase_match,
      body_phrase_match,
      path_phrase_match
    from counted
    order by
      overall_rank desc,
      exact_heading_match desc,
      heading_phrase_rank desc,
      path_phrase_rank desc,
      cluster_support_count desc,
      body_phrase_rank desc,
      section_rank desc,
      coalesce(chunk_phrase_rank, 0) desc,
      coalesce(chunk_rank, 0) desc,
      citation_label asc
    limit $4
    offset $5
    `,
    [
      normalizedQuery,
      singularizedPhrase,
      corpus,
      limit,
      offset,
      exactSectionKey,
      exactCitationCompact,
    ],
  );

  const total = result.rows[0]?.total_count ?? 0;

  return {
    query: normalizedQuery,
    corpus,
    limit,
    offset,
    total,
    hasMore: offset + result.rows.length < total,
    results: result.rows.map((row) => ({
      sectionId: row.section_id,
      sectionKey: row.section_key,
      citationLabel: row.citation_label,
      heading: row.heading,
      path: row.path,
      pathText: row.path_text,
      documentSlug: row.document_slug,
      documentTitle: row.document_title,
      documentCorpus: row.document_corpus,
      sourceUrl: row.source_url,
      sourceAnchor: row.source_anchor,
      rank: Number(row.overall_rank),
      sectionRank: Number(row.section_rank),
      pathRank: Number(row.path_phrase_rank),
      bodyRank: Number(row.body_phrase_rank),
      chunkRank: row.chunk_rank !== null ? Number(row.chunk_rank) : null,
      clusterSupportCount: Number(row.cluster_support_count ?? 0),
      sectionContent: row.section_content,
      matchSignals: {
        exactSectionKeyMatch: row.exact_section_key_match,
        exactCitationMatch: row.exact_citation_match,
        exactHeadingMatch: row.exact_heading_match,
        headingPhraseMatch:
          row.heading_phrase_match || row.heading_phrase_rank > 0,
        bodyPhraseMatch: row.body_phrase_match || row.body_phrase_rank > 0,
        pathPhraseMatch: row.path_phrase_match || row.path_phrase_rank > 0,
      },
    })),
    ...(params.includeDebug
      ? {
          debug: {
            tsQuery,
            phraseQuery,
            singularPhrase: singularizedPhrase,
            singularPhraseQuery,
            queryLower: normalizedQuery.toLowerCase(),
            exactSectionKey,
            exactCitationCompact,
            offset,
            total,
          },
        }
      : {}),
  };
}