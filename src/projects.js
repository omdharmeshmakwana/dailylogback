import { pool } from './db.js'
import { notFound } from './errors.js'

// Shaped like the frontend's Project type: episodes is an ordered list of names.
const PROJECT_SELECT = `
  SELECT p.id, p.name, p.archived,
         COALESCE(array_agg(e.name ORDER BY e.position) FILTER (WHERE e.id IS NOT NULL), '{}') AS episodes
  FROM projects p
  LEFT JOIN episodes e ON e.project_id = p.id`

export async function listProjects(db = pool) {
  const { rows } = await db.query(`${PROJECT_SELECT} GROUP BY p.id ORDER BY p.created_at, p.name`)
  return rows
}

export async function getProject(id, db = pool) {
  const { rows } = await db.query(`${PROJECT_SELECT} WHERE p.id = $1 GROUP BY p.id`, [id])
  if (!rows[0]) throw notFound('Project not found.')
  return rows[0]
}

// name -> { id, name, archived, episodes: Map<episodeName, episodeId> }
export async function projectLookup(db = pool) {
  const { rows } = await db.query(`
    SELECT p.id, p.name, p.archived, e.id AS episode_id, e.name AS episode
    FROM projects p
    LEFT JOIN episodes e ON e.project_id = p.id`)
  const lookup = new Map()
  for (const row of rows) {
    if (!lookup.has(row.name)) lookup.set(row.name, { id: row.id, name: row.name, archived: row.archived, episodes: new Map() })
    if (row.episode_id) lookup.get(row.name).episodes.set(row.episode, row.episode_id)
  }
  return lookup
}
