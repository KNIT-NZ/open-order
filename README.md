## Open Order

Open Order is a procedural search and reasoning tool for New Zealand parliamentary rules, designed to make complex institutional material accessible through natural language queries.

It focuses on two core documents:
- **Standing Orders (2023)**
- **Speaker’s Rulings (2023)**

The system allows users to ask practical, situational questions (e.g. about debate procedure, member conduct, or points of order) and receive structured, source-grounded answers anchored in the relevant authorities.

---

## Purpose

Open Order is a proof-of-concept for a broader class of systems: tools that enable **natural language exploration of structured legal and institutional corpora**.

Rather than treating documents as flat text, the project explores how:
- procedural concepts,
- document structure,
- and authority roles

can be combined to produce answers that reflect how the system actually operates in practice.

---

## Architecture Overview

The system is built as a layered pipeline:

1. **Query Planning**
   - A lightweight planner prompt converts user questions into 1–3 targeted search queries.
   - Queries are biased toward canonical procedural language rather than surface phrasing.

2. **Concept Inference**
   - The question is mapped to a small internal **concept registry** (e.g. closure, point of order, relevancy, ministerial accountability).
   - Concepts provide reusable semantic anchors for both retrieval and reasoning.

3. **Query Expansion**
   - Planner queries are augmented with concept-derived queries to improve recall and consistency.

4. **Retrieval**
   - PostgreSQL full-text search (GIN / `tsvector`) over structured sections and chunks.
   - Ranking combines:
     - lexical match (A/B/C weighting),
     - heading and citation prominence,
     - hierarchical path signals,
     - cluster support across queries.

5. **Authority Classification**
   - Retrieved sections are classified into procedural roles:
     - governing rule
     - procedural mechanism
     - chair control
     - constraint or qualification
     - supporting authority

6. **Authority Selection**
   - A concept-aware selector constructs a compact “authority pack”
   - Typically 2–4 authorities representing different roles in the procedural system
   - Selection is guided by blueprint patterns (e.g. rule + mechanism + constraint)

7. **Grounded Answer Generation**
   - The model receives only the selected authority pack
   - Answers must be grounded explicitly in retrieved material
   - Strict citation rules are enforced

8. **Validation and Post-processing**
   - Outputs are validated for:
     - invalid citations
     - ungrounded authority mentions in prose
   - A rewrite pass removes unsupported references where possible
   - If validation fails, a deterministic fallback answer is returned

---

## Key Design Choices

### 1. Concepts over Keywords
Instead of relying purely on search queries, the system introduces a **concept registry** that captures recurring procedural ideas.  
This allows different phrasings of a question to converge on the same underlying structure.

### 2. Structured Authority Packs
Answers are not generated from arbitrary search results.  
They are built from a **curated set of authorities**, each with a defined procedural role.

This mirrors how practitioners reason about rules:
- What is the governing rule?
- What mechanism enforces it?
- What limits or qualifies it?

### 3. Separation of Retrieval and Reasoning
- Retrieval is handled by a general-purpose search layer
- Reasoning happens in a separate selection and classification layer

This keeps the system extensible and avoids entangling ranking with interpretation.

### 4. Defensive Output Handling
The system treats model output as untrusted until validated:
- citation checks
- authority mention checks
- controlled fallback behaviour

This is essential for any application dealing with legal or procedural material.

---

## Current Capabilities

Open Order can:
- Interpret natural language questions about parliamentary procedure
- Retrieve relevant sections and rulings from multiple documents
- Construct compact, role-balanced authority sets
- Produce grounded, structured answers with explicit citations
- Reject or repair answers that introduce unsupported references

---

## Technical Stack

- **Next.js (App Router)** — frontend and API routes  
- **TypeScript** — end-to-end typing  
- **PostgreSQL (Neon)** — document storage and full-text search  
- **tsvector / GIN indexes** — ranked lexical retrieval  
- **LLM (Gemini)** — planning and answer generation  
- **Custom reasoning layer** — concept inference, authority classification, selection logic  

---

## Direction

This project is intentionally scoped, but the architecture is designed to scale.

The same approach — combining:
- structured ingestion,
- concept mapping,
- authority-role reasoning,
- and validated generation

can be extended to much larger corpora, including legislation and regulatory frameworks.

Open Order serves as a working demonstration of how those systems might be built.