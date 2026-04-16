import { db } from '../lib/db'

async function main() {
  const result = await db.query<{
    slug: string
    title: string
    corpus: string
  }>(`
    select slug, title, corpus
    from documents
    order by slug
  `)

  console.log('Documents:')
  for (const row of result.rows) {
    console.log(`- ${row.slug} | ${row.corpus} | ${row.title}`)
  }
}

main()
  .catch((error) => {
    console.error('Failed to list documents.')
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await db.end()
  })