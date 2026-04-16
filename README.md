# Open Order

Open Order is an evidence-first procedural retrieval application for New Zealand parliamentary material, beginning with:

- Speakers' Rulings 2023
- Standing Orders 2023

## Principles

- Evidence first
- Summary second
- Graceful degradation when LLMs fail or are removed
- Citable units are sections/rulings, not opaque chunks

## Repo shape

- `app/` — Next.js App Router UI and route handlers
- `lib/` — shared app/server utilities
- `scripts/` — ingestion, chunking, indexing, and maintenance scripts
- `infra/sql/` — SQL schema and migration files
- `data/sources/` — manifests and source metadata
- `docs/` — architecture and implementation notes