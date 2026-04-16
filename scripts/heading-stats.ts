import { db } from '../lib/db'

async function main() {
  const result = await db.query<{
    heading: string | null
    count: string
  }>(`
    select
      heading,
      count(*)::text as count
    from sections s
    join documents d on d.id = s.document_id
    where d.slug = 'speakers-rulings-2023'
    group by heading
    order by count(*) desc, heading nulls first
  `)

  console.log('Heading distribution for speakers-rulings-2023:')
  for (const row of result.rows) {
    console.log(`- ${row.heading ?? '(null)'}: ${row.count}`)
  }
}

main()
  .catch((error) => {
    console.error('Failed to inspect heading stats.')
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await db.end()
  })