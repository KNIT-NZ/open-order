-- Stronger lexical search support for Open Order.
-- Key change: index procedural identity, not just heading/body.
-- We keep sections as the surfaced retrieval unit and chunks as hidden support.

begin;

drop index if exists idx_sections_search_tsv;
drop index if exists idx_sections_lower_section_key;
drop index if exists idx_sections_compact_citation_label;

alter table sections
drop column if exists search_tsv;

alter table sections
add column search_tsv tsvector generated always as (
  setweight(to_tsvector('english', coalesce(citation_label, '')), 'A') ||
  setweight(to_tsvector('simple',  coalesce(section_key, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(heading, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(array_to_string(path, ' '), '')), 'B') ||
  setweight(to_tsvector('english', coalesce(content, '')), 'C')
) stored;

create index if not exists idx_sections_search_tsv
  on sections
  using gin (search_tsv);

create index if not exists idx_sections_lower_section_key
  on sections (lower(section_key));

create index if not exists idx_sections_compact_citation_label
  on sections ((lower(regexp_replace(citation_label, '\s+', '', 'g'))));

drop index if exists idx_chunks_search_tsv;

alter table chunks
drop column if exists search_tsv;

alter table chunks
add column search_tsv tsvector generated always as (
  to_tsvector('english', coalesce(content, ''))
) stored;

create index if not exists idx_chunks_search_tsv
  on chunks
  using gin (search_tsv);

commit;