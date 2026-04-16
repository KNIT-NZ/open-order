import { db } from '../lib/db'

async function main() {
  const result = await db.query<{
    chapter: string | null
    chapter_title: string | null
    count: string
  }>(`
    select
      s.metadata->>'chapter' as chapter,
      s.metadata->>'chapterTitle' as chapter_title,
      count(*)::text as count
    from sections s
    join documents d on d.id = s.document_id
    where d.slug = 'speakers-rulings-2023'
    group by 1, 2
    order by
      case when s.metadata->>'chapter' ~ '^\d+$'
        then (s.metadata->>'chapter')::int
        else 9999
      end,
      chapter_title nulls first
  `)

  console.log('Chapter distribution for speakers-rulings-2023:')
  for (const row of result.rows) {
    console.log(
      `- Chapter ${row.chapter ?? '(null)'} | ${row.chapter_title ?? '(null)'}: ${row.count}`
    )
  }
}

main()
  .catch((error) => {
    console.error('Failed to inspect chapter stats.')
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await db.end()
  })