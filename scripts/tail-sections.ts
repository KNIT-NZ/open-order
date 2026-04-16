import { db } from '../lib/db'

async function main() {
  const result = await db.query<{
    citation_label: string
    heading: string | null
    content: string
    ordinal: number
  }>(`
    select citation_label, heading, content, ordinal
    from sections s
    join documents d on d.id = s.document_id
    where d.slug = 'speakers-rulings-2023'
    order by ordinal desc
    limit 20
  `)

  console.log('Last 20 sections:')
  for (const row of result.rows.reverse()) {
    console.log('---')
    console.log(`${row.ordinal} | ${row.citation_label} | ${row.heading ?? '(no heading)'}`)
    console.log(row.content.slice(0, 300))
  }
}

main()
  .catch((error) => {
    console.error('Failed to inspect tail sections.')
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await db.end()
  })