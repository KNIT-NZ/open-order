# Open Order changelog

## Privacy — operational observability foundation

- Introduce closed metadata-only search and AI-stream event DTO, isolated writer and separate review-only SQL schema.
- Persistence disabled pending separately approved roles, expiry scheduler, notices and live acceptance. No migration applied.


## Privacy P0 — content-retention cessation

- Remove routine search query and debug persistence; move search to JSON POST and reject GET.
- Stop writing ordinary query text into browser URLs; mark search and AI responses no-store.
- Clarify external AI processing, independent status and sensitive diagnostic feedback.
- No legacy data deletion or database schema change; durable metadata-only traces and verified expiry remain outstanding.


## Unreleased

- Update runtime and development dependencies to address known vulnerabilities; migrate validation to Zod 4.
- Add deterministic authority, citation, input validation, provider-failure, database TLS and safe answer rendering regression tests.
- Require verified TLS for remote PostgreSQL connections; remote deployments must have a trusted certificate chain.
- Add interface and setup documentation, public feedback links, pinned CI actions and a routine dependency update cooldown.

- Establish an explicit regression-testing and release assurance policy and configure open-source static security analysis.

## Governance baseline — 2026-11-25

Source: [1cefffc](https://github.com/KNIT-NZ/open-order/commit/1cefffc1516b0fb450abf5e40e9aa06efc582b18).

- Publish original software under Apache-2.0, with separately governed materials identified in LICENSE-SCOPE.md.
- Add contribution, governance, security-reporting and citation documentation.
- Add automated TypeScript and ESLint checks and dependency update monitoring.
- No runtime application logic or dependency versions changed in this commit.

## Release practice

Identify deployed source by its full Git commit SHA. For formal numbered releases, use semantic versioning and a Git tag, publish a human-readable summary of changes and upgrade implications, and identify publicly known project vulnerabilities fixed in that release (including assigned CVEs or equivalent identifiers). Record security fixes without prematurely disclosing private reports. This policy applies prospectively; it is not a reconstruction of all historical release notes.
