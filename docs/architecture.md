# Open Order Architecture

## Current direction

Open Order is being built as a single Next.js application with:

- App Router UI
- route handlers for API endpoints
- Postgres as the system of record
- external scripts for ingestion/chunking/indexing

## Why this shape

At MVP stage the difficult problems are:

- parsing source material correctly
- preserving citable section structure
- chunking for retrieval without losing citation fidelity
- producing safe evidence-first answers
- shipping quickly

This does not require microservices.

## Core concepts

### Documents
Top-level artefacts such as:
- Speakers' Rulings 2023
- Standing Orders 2023

### Sections
Citable units such as:
- a single ruling
- a standing order clause
- another formally addressable unit

### Chunks
Retrieval units derived from sections. Chunks support search. Sections support citation.

## Near-term next steps

1. wire Neon env vars
2. confirm DB connectivity
3. add schema files in `infra/sql`
4. create source manifest in `data/sources`
5. implement Speakers' Rulings ingestion first