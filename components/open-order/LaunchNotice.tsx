import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./LaunchNotice.module.css";

// Public notice only. No user data or telemetry is collected here.
const standingOrders = "2023 (database edition labels; coverage not certified)";
const speakersRulings = "2023 (database edition labels; coverage not certified)";
const privacyContact = "admin@knit.nz";
const operator = "KNIT Aotearoa Charitable Trust";
export function LaunchFooter() {
  return <div className={styles.footerNotice}>
    <p>Independent experimental guidance — AI can be wrong. Verify official sources. Standing Orders: {standingOrders.split(" (")[0]}{standingOrders === "2023 (database edition labels; coverage not certified)" ? " (superseded)" : ""}. Do not submit confidential, privileged or identifying information.</p>
    <nav aria-label="Open Order information" className={styles.links}>
      <Link href="/privacy">Privacy</Link>
      <Link href="/sources">Sources</Link>
      <Link href="/corrections">Corrections</Link>
      <Link href="/about">About</Link>
      <a href="https://github.com/KNIT-NZ/open-order">Source code</a>
      <a href="https://github.com/KNIT-NZ/open-order/blob/main/CONTRIBUTING.md">Contribute</a>
    </nav>
  </div>;
}

export function PolicyLayout({ title, children }: { title: string; children: ReactNode }) {
  return <main className={styles.policy}>
    <Link href="/" className={styles.back}>← Open Order</Link>
    <h1>{title}</h1>
    <div className={styles.content}>{children}</div>
    <nav aria-label="Related information" className={styles.links}>
      <Link href="/privacy">Privacy</Link>
      <Link href="/sources">Sources</Link>
      <Link href="/corrections">Corrections</Link>
      <Link href="/about">About</Link>
    </nav>
  </main>;
}

export function PrivacyContent() {
  return <>
    <p>Answers can be wrong or incomplete. Do not submit confidential, privileged or identifying information. AI requests are processed by external providers. <Link href="/privacy">Read the privacy notice</Link>.</p>
    <p>Search text is processed to retrieve parliamentary sources. For AI answers, questions, derived queries and relevant source material may be sent to external inference providers, including Gemini or an OpenAI-compatible service depending on configuration. Hosting and database providers also process service requests and infrastructure data. Processing may occur outside New Zealand.</p>
    <p>Open Order removed its routine application search-content log and deleted the historical records from the live database in November 2026. The new persistent operational telemetry writer is disabled; no new trace-retention programme is active. Infrastructure logs, provider retention, training arrangements and backup expiry have not been fully verified. We do not promise zero retention, confidential processing or parliamentary privilege.</p>
    <p>Diagnostic snapshots are available in your browser and can include your question, answer and retrieval details. Copying or sharing them is voluntary. Review and redact them first. Do not post sensitive content in public issues. There is no automatic submission of these snapshots to a KNIT evaluation corpus.</p>
    <p>For privacy enquiries, access or correction requests, or private reports of wrong interpretations, missing or stale sources and technical faults, contact <a href={"mailto:" + privacyContact}>{privacyContact}</a>. Start with a non-sensitive description, relevant public source or request reference if available; please do not send confidential details. A request reference does not guarantee a retained trace. You can also raise a non-sensitive public issue on <a href="https://github.com/KNIT-NZ/open-order/issues">GitHub</a>. KNIT triages software and source corrections, not parliamentary procedural appeals. Use the repository’s <a href="https://github.com/KNIT-NZ/open-order/blob/main/SECURITY.md">security disclosure pathway</a> for vulnerabilities. You may contact the <a href="https://www.privacy.org.nz/your-rights/complaint-or-privacy-breach/">Office of the Privacy Commissioner</a> about privacy concerns.</p>
  </>;
}

export function SourcesContent() {
  return <>
    <p>Indexed Standing Orders: {standingOrders}. Indexed Speakers’ Rulings: {speakersRulings}. Parliament publishes the 2026 Standing Orders; source migration and completeness have not been certified. Check the <a href="https://www3.parliament.nz/en/pb/parliamentary-rules/standing-orders/">official Standing Orders</a> and <a href="https://www3.parliament.nz/en/pb/parliamentary-rules/speakers-rulings/">Speakers’ Rulings</a> before relying on results.</p>
    <p>Source attribution: Open Order includes and adapts Standing Orders and Speakers’ Rulings material from the Office of the Clerk and Parliamentary Service. For content covered by Parliament’s reuse licence, credit is due to the Clerk of the House of Representatives and/or the Parliamentary Corporation on behalf of Parliamentary Service under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Open Order indexes, excerpts and transforms this material; consult <a href="https://www.parliament.nz/Copyright">Parliament’s copyright policy</a> and the original authorities. The software licence does not relicense parliamentary material or third-party content.</p>
  </>;
}

export function CorrectionsContent() {
  return <>
    <p>For privacy enquiries, access or correction requests, or private reports of wrong interpretations, missing or stale sources and technical faults, contact <a href={"mailto:" + privacyContact}>{privacyContact}</a>. Start with a non-sensitive description, relevant public source or request reference if available; please do not send confidential details. A request reference does not guarantee a retained trace. You can also raise a non-sensitive public issue on <a href="https://github.com/KNIT-NZ/open-order/issues">GitHub</a>. KNIT triages software and source corrections, not parliamentary procedural appeals. Use the repository’s <a href="https://github.com/KNIT-NZ/open-order/blob/main/SECURITY.md">security disclosure pathway</a> for vulnerabilities. You may contact the <a href="https://www.privacy.org.nz/your-rights/complaint-or-privacy-breach/">Office of the Privacy Commissioner</a> about privacy concerns.</p>
  </>;
}

export function AboutContent() {
  return <>
    <p>Open Order is operated by {operator}, independently of Parliament. It is not operated or endorsed by Parliament, does not issue official rulings and is not legal advice. Seek authoritative procedural guidance where needed.</p>
  </>;
}
