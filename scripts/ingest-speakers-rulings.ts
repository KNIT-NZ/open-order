import fs from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { CanvasFactory } from "pdf-parse/worker";
import { db } from "../lib/db";
import {
  cleanLine,
  isLikelyPageNoise,
  isRulingStart,
  normalizePdfText,
  splitTrailingCitations,
} from "../lib/text";

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

type ParsedRuling = {
  rulingNumber: string;
  chapter: string | null;
  chapterTitle: string | null;
  heading: string | null;
  content: string;
  citations: string[];
};

async function readManifest() {
  const manifestPath = path.join(
    process.cwd(),
    "data",
    "sources",
    "source-manifest.json",
  );

  console.log(`Reading manifest from ${manifestPath}`);
  const raw = await fs.readFile(manifestPath, "utf8");
  return JSON.parse(raw) as SourceManifest;
}

function parseChapterLine(
  line: string,
): { chapter: string; title: string | null } | null {
  const match = line.match(/^CHAPTER\s+(\d+)(.*)$/);
  if (!match) return null;

  const title = match[2]?.trim() || null;

  return {
    chapter: match[1],
    title: title || null,
  };
}

function isAllCapsHeading(line: string): boolean {
  if (!line) return false;
  if (line.length < 3) return false;
  if (!/[A-Z]/.test(line)) return false;
  return line === line.toUpperCase();
}

function isLikelyHeading(line: string): boolean {
  if (!line) return false;
  if (isRulingStart(line)) return false;
  if (/^\d+SOs/.test(line)) return false;
  if (/^\d+\//.test(line)) return false;
  if (/^\d{4},\s*Vol\./.test(line)) return false;
  if (/^Report of /.test(line)) return false;
  if (/^Question of privilege /.test(line)) return false;
  if (/^\(?\d+\)/.test(line)) return false;
  if (isAllCapsHeading(line)) return true;
  if (/^[A-Z][A-Za-z’'()[\]\-,:;& ]+$/.test(line)) return true;
  return false;
}

function parseRulingsFromText(rawText: string): ParsedRuling[] {
  const text = normalizePdfText(rawText);

  const firstRulingMatch = text.match(/\b1\/1\b/);
  if (!firstRulingMatch || firstRulingMatch.index === undefined) {
    const preview = text.slice(0, 2000);
    throw new Error(
      `Could not find first real ruling 1/1 in Speakers’ Rulings PDF text. Preview:\n${preview}`,
    );
  }

  const firstRulingIndex = firstRulingMatch.index;

  // Try to recover nearby structural context immediately before 1/1.
  // This should capture things like:
  // CHAPTER 1
  // GENERAL PROVISIONS AND OFFICE HOLDERS
  // INTRODUCTION (SOs 1–7)
  // Leave
  //
  // But we do not want to go all the way back into the contents pages.
  const lookbackStart = Math.max(0, firstRulingIndex - 2500);
  const preludeWindow = text.slice(lookbackStart, firstRulingIndex);

  const chapterOneIndexInWindow = preludeWindow.lastIndexOf("CHAPTER 1");
  const workingStart =
    chapterOneIndexInWindow === -1
      ? firstRulingIndex
      : lookbackStart + chapterOneIndexInWindow;

  const indexMarker = "\nINDEX";
  const indexStart = text.indexOf(indexMarker, firstRulingIndex);

  const working =
    indexStart === -1
      ? text.slice(workingStart)
      : text.slice(workingStart, indexStart);

  const lines = working.split("\n").map(cleanLine);

  const rulings: ParsedRuling[] = [];

  let currentChapter: string | null = null;
  let currentChapterTitle: string | null = null;
  let currentHeading: string | null = null;

  let currentRulingNumber: string | null = null;
  let currentRulingLines: string[] = [];

  function flushCurrentRuling() {
    if (!currentRulingNumber) return;

    const trimmed = currentRulingLines.map(cleanLine).filter(Boolean);
    if (trimmed.length === 0) return;

    const { bodyLines, citationLines } = splitTrailingCitations(trimmed);

    rulings.push({
      rulingNumber: currentRulingNumber,
      chapter: currentChapter,
      chapterTitle: currentChapterTitle,
      heading: currentHeading,
      content: bodyLines.join("\n"),
      citations: citationLines,
    });
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!line) continue;
    if (isLikelyPageNoise(line)) continue;

    // Ignore short index/table-of-contents style lines that merely end in a ruling reference.
    if (
      !currentRulingNumber &&
      /\b\d+\/\d+\b$/.test(line) &&
      !isRulingStart(line)
    ) {
      continue;
    }

    const chapterParsed = parseChapterLine(line);
    if (chapterParsed) {
      currentChapter = chapterParsed.chapter;

      const nextLine = cleanLine(lines[i + 1] ?? "");
      if (
        nextLine &&
        !isLikelyPageNoise(nextLine) &&
        !isRulingStart(nextLine) &&
        isAllCapsHeading(nextLine)
      ) {
        currentChapterTitle = nextLine;
      } else {
        currentChapterTitle = null;
      }

      currentHeading = null;
      continue;
    }

    if (
      currentChapter &&
      currentChapterTitle === null &&
      isAllCapsHeading(line)
    ) {
      currentChapterTitle = line;
      currentHeading = null;
      continue;
    }

    // Only treat heading-like lines as headings if they appear outside a ruling.
    // Allow heading updates whenever we're NOT currently accumulating a ruling body
    if (!currentRulingNumber || currentRulingLines.length === 0) {
      if (isLikelyHeading(line)) {
        currentHeading = line;
        continue;
      }
    }

    // Detect heading transitions between rulings
    if (!currentRulingNumber && isLikelyHeading(line)) {
      currentHeading = line;
      continue;
    }

    if (isRulingStart(line)) {
      flushCurrentRuling();

      // Reset heading detection window after each ruling
      currentHeading = currentHeading;

      const firstSpace = line.indexOf(" ");
      if (firstSpace === -1) {
        currentRulingNumber = line.trim();
        currentRulingLines = [];
      } else {
        currentRulingNumber = line.slice(0, firstSpace).trim();
        const rest = line.slice(firstSpace + 1).trim();
        currentRulingLines = rest ? [rest] : [];
      }

      continue;
    }

    if (currentRulingNumber) {
      currentRulingLines.push(line);
      continue;
    }
  }

  flushCurrentRuling();

  return rulings;
}

async function main() {
  console.log("Starting Speakers’ Rulings ingestion...");
  const manifest = await readManifest();

  const source = manifest.sources.find(
    (item) => item.slug === "speakers-rulings-2023",
  );

  if (!source?.sourcePath) {
    throw new Error(
      "Could not find sourcePath for speakers-rulings-2023 in manifest.",
    );
  }

  const pdfPath = path.join(process.cwd(), source.sourcePath);
  console.log(`Resolved PDF path: ${pdfPath}`);

  const buffer = await fs.readFile(pdfPath);
  console.log(`Read PDF buffer: ${buffer.byteLength} bytes`);

  console.log("Extracting text from PDF...");
  const parser = new PDFParse({ data: buffer, CanvasFactory });
  const parsedText = await parser.getText();

  console.log(`Extracted text length: ${parsedText.text.length}`);

  const rulings = parseRulingsFromText(parsedText.text);
  console.log(`Parsed rulings: ${rulings.length}`);

  const rulingCounts = new Map<string, number>();

  for (const ruling of rulings) {
    rulingCounts.set(
      ruling.rulingNumber,
      (rulingCounts.get(ruling.rulingNumber) ?? 0) + 1,
    );
  }

  const duplicates = [...rulingCounts.entries()].filter(
    ([, count]) => count > 1,
  );

  if (duplicates.length > 0) {
    console.error("Duplicate ruling numbers detected:");
    for (const [rulingNumber, count] of duplicates.slice(0, 20)) {
      console.error(`- ${rulingNumber}: ${count}`);
    }

    throw new Error(
      `Parsed duplicate ruling numbers before insert. Duplicate count: ${duplicates.length}`,
    );
  }

  if (rulings.length === 0) {
    throw new Error("Parsed zero rulings from PDF text.");
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
      "ingest_speakers_rulings",
      "running",
      JSON.stringify({
        documentSlug: "speakers-rulings-2023",
        sourcePath: source.sourcePath,
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

    for (const ruling of rulings) {
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
          [
            ruling.chapter ? `Chapter ${ruling.chapter}` : null,
            ruling.chapterTitle,
            ruling.heading,
          ].filter(Boolean),
          ruling.chapter ? `Chapter ${ruling.chapter}` : null,
          source.sourcePath,
          ruling.rulingNumber,
          ruling.heading,
          ruling.content,
          ruling.content,
          JSON.stringify({
            rulingNumber: ruling.rulingNumber,
            chapter: ruling.chapter,
            chapterTitle: ruling.chapterTitle,
            heading: ruling.heading,
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
          insertedSections: rulings.length,
        }),
      ],
    );

    await db.query("commit");
    console.log(`Committed build ${buildId}`);
    console.log(`Ingested ${rulings.length} Speakers’ Rulings sections.`);
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
  console.error("Failed to ingest Speakers’ Rulings.");
  console.error(error);
  process.exit(1);
});
