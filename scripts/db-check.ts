import { checkDatabaseConnection } from '../lib/db'

async function main() {
  const result = await checkDatabaseConnection()

  console.log('Database connection OK')
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error('Database connection failed')
  console.error(error)
  process.exit(1)
})