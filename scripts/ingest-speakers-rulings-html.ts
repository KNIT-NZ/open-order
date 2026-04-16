
// scripts/ingest-speakers-rulings-html.ts
import { db } from "../lib/db";
import {
  extractChapterUrls,
  fetchHtml,
  parseChapterPage,
  SPEAKERS_RULINGS_INDEX_URL,
} from "../lib/speakers-rulings-html";

type SourceManifest = {
  sources: Array<{
    slug: string;
    title: string;
    corpus: string;
    sourceType: string;
    sourcePath?: string;
    sourceUrl?: string;
    edition?: string;
    language?: string;
    publishedDate?: string;
    metadata?: Record<string, unknown>;
  }>;
};

async function readManifest(): Promise<SourceManifest> {
  const path = `${process.cwd()}/data/sources/source-manifest.json`;
  const raw = await import("node:fs/promises").then((fs) =>
    fs.readFile(path, "utf8"),
  );
  return JSON.parse(raw) as SourceManifest;
}

async function main() {
  console.log("Starting Speakers’ Rulings HTML ingestion...");

  const manifest = await readManifest();
  const source = manifest.sources.find(
    (item) => item.slug === "speakers-rulings-2023",
  );

  if (!source) {
    throw new Error("Could not find speakers-rulings-2023 in source manifest.");
  }

  const indexUrl = source.sourceUrl ?? SPEAKERS_RULINGS_INDEX_URL;
  console.log(`Fetching index page: ${indexUrl}`);

  const indexHtml = await fetchHtml(indexUrl);
  const chapterUrls = extractChapterUrls(indexHtml);

  console.log(`Found chapter pages: ${chapterUrls.length}`);

  if (chapterUrls.length === 0) {
    throw new Error("No chapter URLs found on Speakers’ Rulings index page.");
  }

  const allRulings = [];

  for (const chapterUrl of chapterUrls) {
    console.log(`Fetching chapter page: ${chapterUrl}`);
    const chapterHtml = await fetchHtml(chapterUrl);
    const chapterRulings = parseChapterPage(chapterHtml, chapterUrl);
    console.log(
      `Parsed ${chapterRulings.length} rulings from ${chapterUrl} ` +
        `(first=${chapterRulings[0]?.rulingNumber ?? "none"}, ` +
        `last=${chapterRulings[chapterRulings.length - 1]?.rulingNumber ?? "none"})`,
    );
    allRulings.push(...chapterRulings);
  }

  console.log(`Parsed total rulings: ${allRulings.length}`);

  const counts = new Map<string, number>();
  for (const ruling of allRulings) {
    counts.set(ruling.rulingNumber, (counts.get(ruling.rulingNumber) ?? 0) + 1);
  }

  const duplicates = [...counts.entries()].filter(([, count]) => count > 1);
  if (duplicates.length > 0) {
    console.error("Duplicate ruling numbers detected:");
    for (const [rulingNumber, count] of duplicates.slice(0, 20)) {
      console.error(`- ${rulingNumber}: ${count}`);
    }
    throw new Error(`Duplicate ruling numbers found: ${duplicates.length}`);
  }

  const docResult = await db.query<{ id: string }>(
    `
    select id
    from documents
    where slug = $1
    limit 1
    `,
    ["speakers-rulings-2023"],
  );

  if (docResult.rows.length === 0) {
    throw new Error(
      "Document row not found for speakers-rulings-2023. Seed documents first.",
    );
  }

  const documentId = docResult.rows[0].id;

  const buildResult = await db.query<{ id: string }>(
    `
    insert into builds (build_type, status, metadata)
    values ($1, $2, $3::jsonb)
    returning id
    `,
    [
      "ingest_speakers_rulings_html",
      "running",
      JSON.stringify({
        documentSlug: "speakers-rulings-2023",
        sourceUrl: indexUrl,
        chapterCount: chapterUrls.length,
      }),
    ],
  );

  const buildId = buildResult.rows[0].id;
  console.log(`Created build: ${buildId}`);

  try {
    await db.query("begin");
    console.log("Transaction started");

    await db.query(
      `
      delete from sections
      where document_id = $1
      `,
      [documentId],
    );

    console.log("Deleted existing sections for document");

    let ordinal = 1;

    for (const ruling of allRulings) {
      await db.query(
        `
        insert into sections (
          document_id,
          build_id,
          section_key,
          section_type,
          citation_label,
          ordinal,
          path,
          source_locator,
          source_url,
          source_anchor,
          heading,
          content,
          content_markdown,
          metadata
        )
        values (
          $1, $2, $3, $4, $5, $6,
          $7::text[],
          $8, $9, $10, $11, $12, $13, $14::jsonb
        )
        `,
        [
          documentId,
          buildId,
          ruling.rulingNumber,
          "ruling",
          ruling.rulingNumber,
          ordinal,
          ruling.path,
          `Chapter ${ruling.chapter}`,
          ruling.sourceUrl,
          ruling.rulingNumber,
          ruling.heading,
          ruling.content,
          ruling.content,
          JSON.stringify({
            rulingNumber: ruling.rulingNumber,
            chapter: ruling.chapter,
            chapterTitle: ruling.chapterTitle,
            sectionHeading: ruling.sectionHeading,
            primaryHeading: ruling.primaryHeading,
            secondaryHeading: ruling.secondaryHeading,
            citations: ruling.citations,
          }),
        ],
      );

      if (ordinal % 50 === 0) {
        console.log(`Inserted ${ordinal} sections...`);
      }

      ordinal += 1;
    }

    await db.query(
      `
      update builds
      set status = 'completed',
          completed_at = now(),
          metadata = metadata || $2::jsonb
      where id = $1
      `,
      [
        buildId,
        JSON.stringify({
          insertedSections: allRulings.length,
        }),
      ],
    );

    await db.query("commit");
    console.log(`Committed build ${buildId}`);
    console.log(
      `Ingested ${allRulings.length} Speakers’ Rulings HTML sections.`,
    );
  } catch (error) {
    await db.query("rollback");
    console.error("Transaction rolled back");

    await db.query(
      `
      update builds
      set status = 'failed',
          completed_at = now(),
          notes = $2
      where id = $1
      `,
      [
        buildId,
        error instanceof Error
          ? (error.stack ?? error.message)
          : "Unknown error",
      ],
    );

    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error("Failed to ingest Speakers’ Rulings HTML.");
  console.error(error);
  process.exit(1);
});
