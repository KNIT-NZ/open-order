import { db } from '../lib/db'

async function main() {
  const result = await db.query<{
    citation_label: string
    heading: string | null
    content: string
  }>(`
    select citation_label, heading, content
    from sections
    order by ordinal
    limit 5
  `)

  for (const row of result.rows) {
    console.log('---')
    console.log(row.citation_label, '|', row.heading ?? '(no heading)')
    console.log(row.content.slice(0, 500))
  }
}

main()
  .catch((error) => {
    console.error('Failed to sample sections.')
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await db.end()
  })