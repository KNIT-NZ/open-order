import { db } from '../lib/db'

async function main() {
  const result = await db.query<{
    citation_label: string
    content: string
    chapter: string | null
    chapter_title: string | null
  }>(`
    select
      s.citation_label,
      s.content,
      s.metadata->>'chapter' as chapter,
      s.metadata->>'chapterTitle' as chapter_title
    from sections s
    join documents d on d.id = s.document_id
    where d.slug = 'speakers-rulings-2023'
      and s.heading is null
    order by s.ordinal
    limit 20
  `)

  console.log('First 20 null-heading sections:')
  for (const row of result.rows) {
    console.log('---')
    console.log(
      `${row.citation_label} | Chapter ${row.chapter ?? '(null)'} | ${row.chapter_title ?? '(null)'}`
    )
    console.log(row.content.slice(0, 300))
  }
}

main()
  .catch((error) => {
    console.error('Failed to inspect null-heading samples.')
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await db.end()
  })