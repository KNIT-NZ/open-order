// Public notice only. No user data or telemetry is collected here.
const standingOrders = "2023 (database edition labels; coverage not certified)";
const speakersRulings = "2023 (database edition labels; coverage not certified)";
const privacyContact = "admin@knit.nz";
const operator = "KNIT Aotearoa Charitable Trust";
export function LaunchNotice() {
  return <aside aria-label="Source currency and privacy" style={{ fontSize: "0.875rem", marginBlock: "0.75rem", padding: "0.75rem", border: "1px solid currentColor", borderRadius: "0.5rem" }}>
    <strong>Independent, experimental guidance — not an official ruling.</strong>
    <p>Indexed Standing Orders: {standingOrders}. Indexed Speakers’ Rulings: {speakersRulings}. Parliament publishes the 2026 Standing Orders; source migration and completeness have not been certified. Check the <a href="https://www3.parliament.nz/en/pb/parliamentary-rules/standing-orders/">official Standing Orders</a> and <a href="https://www3.parliament.nz/en/pb/parliamentary-rules/speakers-rulings/">Speakers’ Rulings</a> before relying on results.</p>
    <p>Answers can be wrong or incomplete. Do not submit confidential, privileged or identifying information. AI requests are processed by external providers. <a href="#privacy-notice">Privacy, sources and corrections</a>.</p>
  </aside>;
}
export function LaunchPrivacyNotice() {
  return <div id="privacy-notice" style={{ fontSize: "0.875rem", marginBlock: "1rem" }}>
    <h2>Privacy, sources and corrections</h2>
    <p>Open Order is operated by {operator}, independently of Parliament. It is not operated or endorsed by Parliament, does not issue official rulings and is not legal advice. Seek authoritative procedural guidance where needed.</p>
    <p>Search text is processed to retrieve parliamentary sources. For AI answers, questions, derived queries and relevant source material may be sent to external inference providers, including Gemini or an OpenAI-compatible service depending on configuration. Hosting and database providers also process service requests and infrastructure data. Processing may occur outside New Zealand.</p>
    <p>Open Order removed its routine application search-content log and deleted the historical records from the live database in November 2026. The new persistent operational telemetry writer is disabled; no new trace-retention programme is active. Infrastructure logs, provider retention, training arrangements and backup expiry have not been fully verified. We do not promise zero retention, confidential processing or parliamentary privilege.</p>
    <p>Diagnostic snapshots are available in your browser and can include your question, answer and retrieval details. Copying or sharing them is voluntary. Review and redact them first. Do not post sensitive content in public issues. There is no automatic submission of these snapshots to a KNIT evaluation corpus.</p>
    <p>For privacy enquiries, access or correction requests, or private reports of wrong interpretations, missing or stale sources and technical faults, contact <a href={"mailto:" + privacyContact}>{privacyContact}</a>. Start with a non-sensitive description, relevant public source or request reference if available; please do not send confidential details. A request reference does not guarantee a retained trace. You can also raise a non-sensitive public issue on <a href="https://github.com/KNIT-NZ/open-order/issues">GitHub</a>. KNIT triages software and source corrections, not parliamentary procedural appeals. Use the repository’s <a href="https://github.com/KNIT-NZ/open-order/blob/main/SECURITY.md">security disclosure pathway</a> for vulnerabilities. You may contact the <a href="https://www.privacy.org.nz/your-rights/complaint-or-privacy-breach/">Office of the Privacy Commissioner</a> about privacy concerns.</p>
    <p>Source attribution: Open Order includes and adapts Standing Orders and Speakers’ Rulings material from the Office of the Clerk and Parliamentary Service. For content covered by Parliament’s reuse licence, credit is due to the Clerk of the House of Representatives and/or the Parliamentary Corporation on behalf of Parliamentary Service under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Open Order indexes, excerpts and transforms this material; consult <a href="https://www.parliament.nz/Copyright">Parliament’s copyright policy</a> and the original authorities. The software licence does not relicense parliamentary material or third-party content.</p>
  </div>;
}
