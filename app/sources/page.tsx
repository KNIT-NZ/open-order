import type { Metadata } from "next";
import { db } from "@/lib/db";
import { PolicyLayout, SourcesContent } from "@/components/open-order/LaunchNotice";

export const metadata: Metadata = { title: "Sources | Open Order", description: "Indexed editions, source currency and parliamentary attribution." };

export const dynamic = "force-dynamic";

export default async function Page() {
  let standingOrders = "not verified";
  let speakersRulings = "not verified";
  let reconciled = false;
  try {
    const result = await db.query<{ corpus: string; edition: string | null; source_checksum: string | null }>(
      "SELECT corpus, edition, source_checksum FROM public.documents WHERE corpus IN ('standing_orders', 'speakers_rulings') ORDER BY corpus",
    );
    const so = result.rows.filter((row) => row.corpus === "standing_orders");
    const sr = result.rows.filter((row) => row.corpus === "speakers_rulings");
    if (so.length === 1 && (so[0].edition === "2023" || so[0].edition === "2026")) {
      standingOrders = so[0].edition === "2023" ? "2023 (superseded)" : "2026 (database edition label)";
      reconciled = so[0].edition === "2026" && so[0].source_checksum === "34771e4a6102b996fc0a9cfc5d3663e06d32cd62395af7d00702a42e0b6eb100";
      if (reconciled) standingOrders = "2026 (reconciled source checksum recorded)";
    }
    if (sr.length === 1 && sr[0].edition === "2023") speakersRulings = "2023 (database edition label)";
  } catch {
    // Do not expose database configuration or make an unsupported currency claim.
  }
  return <PolicyLayout title={"Sources"}><SourcesContent standingOrders={standingOrders} speakersRulings={speakersRulings} reconciled={reconciled} /></PolicyLayout>;
}
