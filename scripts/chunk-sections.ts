// scripts/chunk-sections.ts
import { db } from "../lib/db";
import { chunkSectionText } from "../lib/chunking";

async function main() {
  console.log("Starting section chunking...");

  const buildResult = await db.query<{ id: string }>(
    `
    insert into builds (build_type, status, metadata)
    values ($1, $2, $3::jsonb)
    returning id
    `,
    [
      "chunk_sections",
      "running",
      JSON.stringify({
        strategy: "semantic_lexical_v2",
        targetChars: 1200,
        maxChars: 1800,
      }),
    ],
  );

  const buildId = buildResult.rows[0].id;
  console.log(`Created build: ${buildId}`);

  try {
    await db.query("begin");

    await db.query(`delete from chunks`);
    console.log("Deleted existing chunks");

    const sectionsResult = await db.query<{
      id: string;
      content: string;
    }>(`
      select id, content
      from sections
      order by document_id, ordinal
    `);

    console.log(`Fetched sections: ${sectionsResult.rows.length}`);

    let inserted = 0;

    for (const section of sectionsResult.rows) {
      const chunked = chunkSectionText(section.content, {
        targetChars: 1200,
        maxChars: 1800,
      });

      for (const chunk of chunked) {
        await db.query(
          `
          insert into chunks (
            section_id,
            build_id,
            chunk_index,
            token_count_est,
            content,
            metadata
          )
          values ($1, $2, $3, $4, $5, $6::jsonb)
          `,
          [
            section.id,
            buildId,
            chunk.chunkIndex,
            chunk.tokenCountEst,
            chunk.content,
            JSON.stringify({
              strategy: "semantic_lexical_v2",
            }),
          ],
        );

        inserted += 1;
      }

      if (inserted > 0 && inserted % 100 === 0) {
        console.log(`Inserted chunks: ${inserted}`);
      }
    }

    await db.query(
      `
      update builds
      set status = 'completed',
          completed_at = now(),
          metadata = metadata || $2::jsonb
      where id = $1
      `,
      [buildId, JSON.stringify({ insertedChunks: inserted })],
    );

    await db.query("commit");
    console.log(`Committed build ${buildId}`);
    console.log(`Inserted chunks total: ${inserted}`);
  } catch (error) {
    await db.query("rollback");
    console.error("Chunking transaction rolled back");

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
        error instanceof Error ? (error.stack ?? error.message) : "Unknown error",
      ],
    );

    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error("Failed to chunk sections.");
  console.error(error);
  process.exit(1);
});