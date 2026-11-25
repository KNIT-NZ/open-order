# External interfaces

Open Order is an independent experimental procedural navigator, not an official parliamentary ruling or legal advice. It uses the Standing Orders and Speaker’s Rulings corpus; check the original authority and its currency before relying on an answer.

## Browser interface

Visit https://openorder.knit.nz/ to search for procedural material or ask a natural-language question. Search results contain source text and citation links. The assistant streams progress and a source-grounded response; a degraded answer may contain source-only evidence rather than a definitive answer. Query URL parameters `q`, `corpus` and `focus` restore search context; `offset` is used when constructing pagination URLs. Do not enter confidential information: search queries are logged by the application, and assistant requests can be processed by external model providers.

## HTTP interface (experimental; not a stable public API contract)

- `GET /api/health`: JSON with `ok`, `service`, and `timestamp`. This is a process-level health response, not a database or provider readiness probe.
- `GET /api/search?q=closure&corpus=standing_orders&limit=10&offset=0`: `q` is required and nonempty, `corpus` is optional (the intended values are `standing_orders` and `speakers_rulings`), `limit` is an integer 1–50 (default 10), `offset` is an integer 0–10000 (default 0). A successful JSON response includes `ok`, `query`, `corpus`, `limit`, `offset`, `total`, `hasMore`, `latencyMs`, and `results`. Each result includes source identity, citation label, heading, content, source URL/anchor, path and ranking/match fields. Highlighted content includes markup; consumers should treat it as untrusted unless safely sanitised. Invalid parameters return HTTP 400 with `ok: false` and validation details. Operational errors may return a server error.
- `POST /api/ai/answer`: JSON body with required nonempty string `question`, and optional `corpus` (`standing_orders`, `speakers_rulings`, or null). The response uses server-sent events (`text/event-stream`). Events include `stage`, `plan`, `authorities`, `diagnostics`, `answer_delta`, `done`, and `error`. `answer_delta` carries `text`; `done` includes `ok`, `question`, `corpus`, `answerText`, `authorities`, and `latencyMs`, with additional fields including degraded/fallback information where applicable. An `error` event contains a message and may include retryability and diagnostic metadata. Invalid JSON or request schema returns HTTP 400 with an error event. Operational errors after streaming starts can occur within HTTP 200; consumers must inspect terminal events. The API, event payloads and limits may evolve prior to v1.0.

For exact implementation, consult the [route sources](../app/api) and [client hooks](../hooks). See [CONTRIBUTING](../CONTRIBUTING.md) for changes and [SECURITY](../SECURITY.md) for private vulnerability reporting.

### P0 search transport cutover

The current search interface supersedes any GET description above: `POST /api/search` with JSON `q`, optional `corpus`, `limit`, `offset`. GET returns 405; no query should appear in the request URL. See [privacy cutover](privacy-cutover.md).
