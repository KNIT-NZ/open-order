// scripts/ingest-standing-orders-html.ts
import { db } from '../lib/db'
import {
  extractChapterUrls,
  fetchHtml,
  parseChapterPage,
  STANDING_ORDERS_INDEX_URL
} from '../lib/standing-orders-html'

type SourceManifest = {
  sources: Array<{
    slug: string
    title: string
    corpus: string
    sourceType: string
    sourcePath?: string
    sourceUrl?: string
    edition?: string
    language?: string
    publishedDate?: string
    metadata?: Record<string, unknown>
  }>
}

async function readManifest(): Promise<SourceManifest> {
  const path = `${process.cwd()}/data/sources/source-manifest.json`
  const raw = await import('node:fs/promises').then((fs) =>
    fs.readFile(path, 'utf8')
  )
  return JSON.parse(raw) as SourceManifest
}

async function main() {
  console.log('Starting Standing Orders HTML ingestion...')

  const manifest = await readManifest()
  const source = manifest.sources.find(
    (item) => item.slug === 'standing-orders-2023'
  )

  if (!source) {
    throw new Error('Could not find standing-orders-2023 in source manifest.')
  }

  const indexUrl = source.sourceUrl ?? STANDING_ORDERS_INDEX_URL
  console.log(`Fetching index page: ${indexUrl}`)

  const indexHtml = await fetchHtml(indexUrl)
  const chapterUrls = extractChapterUrls(indexHtml)

  console.log(`Found chapter pages: ${chapterUrls.length}`)

  if (chapterUrls.length === 0) {
    throw new Error('No chapter URLs found on Standing Orders index page.')
  }

  const allOrders = []

  for (const chapterUrl of chapterUrls) {
    console.log(`Fetching chapter page: ${chapterUrl}`)
    const chapterHtml = await fetchHtml(chapterUrl)
    const chapterOrders = parseChapterPage(chapterHtml, chapterUrl)

    console.log(
      `Parsed ${chapterOrders.length} standing orders from ${chapterUrl} ` +
        `(first=${chapterOrders[0]?.orderNumber ?? 'none'}, ` +
        `last=${chapterOrders[chapterOrders.length - 1]?.orderNumber ?? 'none'})`
    )

    allOrders.push(...chapterOrders)
  }

  console.log(`Parsed total standing orders: ${allOrders.length}`)

  const counts = new Map<string, number>()
  for (const order of allOrders) {
    counts.set(order.orderNumber, (counts.get(order.orderNumber) ?? 0) + 1)
  }

  const duplicates = [...counts.entries()].filter(([, count]) => count > 1)
  if (duplicates.length > 0) {
    console.error('Duplicate standing order numbers detected:')
    for (const [orderNumber, count] of duplicates.slice(0, 20)) {
      console.error(`- ${orderNumber}: ${count}`)
    }
    throw new Error(`Duplicate standing order numbers found: ${duplicates.length}`)
  }

  const docResult = await db.query<{ id: string }>(
    `
    select id
    from documents
    where slug = $1
    limit 1
    `,
    ['standing-orders-2023']
  )

  if (docResult.rows.length === 0) {
    throw new Error(
      'Document row not found for standing-orders-2023. Seed documents first.'
    )
  }

  const documentId = docResult.rows[0].id

  const buildResult = await db.query<{ id: string }>(
    `
    insert into builds (build_type, status, metadata)
    values ($1, $2, $3::jsonb)
    returning id
    `,
    [
      'ingest_standing_orders_html',
      'running',
      JSON.stringify({
        documentSlug: 'standing-orders-2023',
        sourceUrl: indexUrl,
        chapterCount: chapterUrls.length
      })
    ]
  )

  const buildId = buildResult.rows[0].id
  console.log(`Created build: ${buildId}`)

  try {
    await db.query('begin')
    console.log('Transaction started')

    await db.query(
      `
      delete from sections
      where document_id = $1
      `,
      [documentId]
    )

    console.log('Deleted existing sections for document')

    let ordinal = 1

    for (const order of allOrders) {
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
          `so-${order.orderNumber.toLowerCase()}`,
          'standing_order',
          order.orderLabel,
          ordinal,
          order.path,
          order.partHeading
            ? `Chapter ${order.chapterNumber} / ${order.partHeading}`
            : `Chapter ${order.chapterNumber}`,
          order.sourceUrl,
          order.sourceAnchor,
          order.heading,
          order.content,
          order.contentMarkdown,
          JSON.stringify(order.metadata)
        ]
      )

      if (ordinal % 50 === 0) {
        console.log(`Inserted ${ordinal} sections...`)
      }

      ordinal += 1
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
          insertedSections: allOrders.length
        })
      ]
    )

    await db.query('commit')
    console.log(`Committed build ${buildId}`)
    console.log(`Ingested ${allOrders.length} Standing Orders HTML sections.`)
  } catch (error) {
    await db.query('rollback')
    console.error('Transaction rolled back')

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
        error instanceof Error ? (error.stack ?? error.message) : 'Unknown error'
      ]
    )

    throw error
  } finally {
    await db.end()
  }
}

main().catch((error) => {
  console.error('Failed to ingest Standing Orders HTML.')
  console.error(error)
  process.exit(1)
})