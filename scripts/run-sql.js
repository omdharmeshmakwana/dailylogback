// Runs a .sql file against DATABASE_URL: `npm run db:schema` / `npm run db:seed`.
import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import pg from 'pg'

const file = process.argv[2]
if (!file) {
  console.error('Usage: node scripts/run-sql.js <file.sql>')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.')
  process.exit(1)
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
try {
  await client.connect()
  await client.query(await readFile(file, 'utf8'))
  console.log(`Ran ${file}`)
} catch (error) {
  console.error(`Failed to run ${file}: ${error.message}`)
  process.exitCode = 1
} finally {
  await client.end()
}
