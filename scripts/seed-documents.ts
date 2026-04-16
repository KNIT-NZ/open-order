import fs from 'node:fs/promises'
import path from 'node:path'
import { db } from '../lib/db'

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

async function main() {
  const manifestPath = path.join(
    process.cwd(),
    'data',
    'sources',
    'source-manifest.json'
  )

  const raw = await fs.readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(raw) as SourceManifest

  for (const source of manifest.sources) {
    const resolvedSource = source.sourcePath ?? source.sourceUrl ?? null

    await db.query(
      `
      insert into documents (
        slug,
        title,
        corpus,
        source_type,
        source_url,
        edition,
        published_date,
        language,
        metadata
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      on conflict (slug)
      do update set
        title = excluded.title,
        corpus = excluded.corpus,
        source_type = excluded.source_type,
        source_url = excluded.source_url,
        edition = excluded.edition,
        published_date = excluded.published_date,
        language = excluded.language,
        metadata = excluded.metadata,
        updated_at = now()
      `,
      [
        source.slug,
        source.title,
        source.corpus,
        source.sourceType,
        resolvedSource,
        source.edition ?? null,
        source.publishedDate ?? null,
        source.language ?? 'en',
        JSON.stringify(source.metadata ?? {})
      ]
    )

    console.log(`Seeded document: ${source.slug}`)
  }

  console.log('Document seeding complete.')
}

main()
  .catch((error) => {
    console.error('Failed to seed documents.')
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await db.end()
  })