import { db } from '../lib/db'

async function main() {
  const result = await db.query<{ table_name: string }>(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
    order by table_name
  `)

  console.log('Public tables:')
  for (const row of result.rows) {
    console.log(`- ${row.table_name}`)
  }
}

main()
  .catch((error) => {
    console.error('Failed to inspect database.')
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await db.end()
  })