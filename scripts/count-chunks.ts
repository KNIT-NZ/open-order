import { db } from '../lib/db'

async function main() {
  const result = await db.query<{
    slug: string
    chunk_count: string
  }>(`
    select
      d.slug,
      count(c.id)::text as chunk_count
    from documents d
    left join sections s on s.document_id = d.id
    left join chunks c on c.section_id = s.id
    group by d.slug
    order by d.slug
  `)

  console.log('Chunk counts:')
  for (const row of result.rows) {
    console.log(`- ${row.slug}: ${row.chunk_count}`)
  }
}

main()
  .catch((error) => {
    console.error('Failed to count chunks.')
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await db.end()
  })