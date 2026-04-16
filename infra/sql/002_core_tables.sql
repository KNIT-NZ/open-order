-- infra/sql/002_core_tables.sql
-- Core relational schema for Open Order MVP

begin;

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  corpus text not null,
  source_type text not null,
  source_url text,
  source_checksum text,
  edition text,
  published_date date,
  language text not null default 'en',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists builds (
  id uuid primary key default gen_random_uuid(),
  build_type text not null,
  status text not null default 'pending',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists sections (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  build_id uuid references builds(id) on delete set null,

  -- Human/citation identity
  section_key text not null,
  section_type text not null,
  citation_label text not null,

  -- Structure/order
  ordinal integer not null,
  parent_section_id uuid references sections(id) on delete set null,
  path text[] not null default '{}'::text[],

  -- Source location
  source_locator text,
  source_url text,
  source_anchor text,

  -- Content
  heading text,
  content text not null,
  content_markdown text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sections_document_id_section_key_unique unique (document_id, section_key),
  constraint sections_document_id_ordinal_unique unique (document_id, ordinal)
);

create index if not exists idx_sections_document_id on sections(document_id);
create index if not exists idx_sections_build_id on sections(build_id);
create index if not exists idx_sections_section_type on sections(section_type);

create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references sections(id) on delete cascade,
  build_id uuid references builds(id) on delete set null,

  chunk_index integer not null,
  token_count_est integer,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint chunks_section_id_chunk_index_unique unique (section_id, chunk_index)
);

create index if not exists idx_chunks_section_id on chunks(section_id);
create index if not exists idx_chunks_build_id on chunks(build_id);

create table if not exists query_logs (
  id uuid primary key default gen_random_uuid(),
  query_text text not null,
  mode text,
  corpus text,
  top_k integer,
  latency_ms integer,
  result_count integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_query_logs_created_at on query_logs(created_at desc);

commit;