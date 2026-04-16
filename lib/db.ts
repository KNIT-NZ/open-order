// lib/db.ts
import { Pool } from 'pg'
import { env } from '@/lib/env'

declare global {
  var __openOrderPool: Pool | undefined
}

export const db =
  global.__openOrderPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    ssl:
      env.DATABASE_URL.includes('sslmode=require')
        ? { rejectUnauthorized: false }
        : false
  })

if (process.env.NODE_ENV !== 'production') {
  global.__openOrderPool = db
}

export async function checkDatabaseConnection() {
  const client = await db.connect()

  try {
    const result = await client.query<{
      now: string
      current_database: string
      version: string
    }>(`
      select
        now()::text as now,
        current_database()::text as current_database,
        version()::text as version
    `)

    return result.rows[0]
  } finally {
    client.release()
  }
}