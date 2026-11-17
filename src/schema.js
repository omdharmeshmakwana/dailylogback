import { query } from './db.js'

// Tables added after the first deploy. They're created on startup if missing,
// so a redeploy is all an existing database needs. db/schema.sql has the same
// statements for new setups.
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS attendance_notes (
     employee_id  UUID NOT NULL REFERENCES employees (id),
     month        DATE NOT NULL CHECK (extract(day FROM month) = 1),
     note         TEXT NOT NULL CHECK (length(note) BETWEEN 1 AND 2000),
     updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_by   UUID REFERENCES employees (id),
     PRIMARY KEY (employee_id, month)
   )`,
]

let ready = null

// Resolves once the tables exist. A failed attempt (say, the database was
// waking up) is retried on the next call instead of being cached.
export function schemaReady() {
  ready ??= (async () => {
    for (const statement of STATEMENTS) await query(statement)
  })().catch((error) => {
    ready = null
    throw error
  })
  return ready
}
