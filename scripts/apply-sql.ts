import fs from 'node:fs/promises'
import path from 'node:path'
import { db } from '../lib/db'

async function main() {
  const sqlDir = path.join(process.cwd(), 'infra', 'sql')
  const entries = await fs.readdir(sqlDir)
  const sqlFiles = entries
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))

  if (sqlFiles.length === 0) {
    console.log('No SQL files found.')
    return
  }

  for (const file of sqlFiles) {
    const fullPath = path.join(sqlDir, file)
    const sql = await fs.readFile(fullPath, 'utf8')

    console.log(`Applying ${file}...`)
    await db.query(sql)
    console.log(`Applied ${file}`)
  }

  console.log('All SQL files applied successfully.')
}

main()
  .catch((error) => {
    console.error('Failed to apply SQL files.')
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await db.end()
  })