import pg from 'pg'
import { config } from './config.js'

// DATE columns come back as plain 'YYYY-MM-DD' strings instead of JS Dates,
// so a server running in UTC never shifts a work day.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value)

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
})

// Neon closes idle connections when the compute suspends. Without this
// listener that would crash the process instead of just dropping the client.
pool.on('error', (error) => console.error('Idle database client error:', error.message))

// attendance.check_in is a TIME; this renders it the way the UI shows it ("9:41 AM").
export const CHECK_IN = `to_char(DATE '2000-01-01' + check_in, 'FMHH12:MI AM')`

export function query(text, params) {
  return pool.query(text, params)
}

export async function transaction(work) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
