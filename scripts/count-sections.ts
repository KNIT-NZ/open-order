import { db } from '../lib/db'

async function main() {
  const result = await db.query<{
    slug: string
    section_count: string
  }>(`
    select
      d.slug,
      count(s.id)::text as section_count
    from documents d
    left join sections s on s.document_id = d.id
    group by d.slug
    order by d.slug
  `)

  console.log('Section counts:')
  for (const row of result.rows) {
    console.log(`- ${row.slug}: ${row.section_count}`)
  }
}

main()
  .catch((error) => {
    console.error('Failed to count sections.')
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await db.end()
  })