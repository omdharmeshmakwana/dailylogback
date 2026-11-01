import { Router } from 'express'
import { requireAuth, requireManager } from '../auth.js'
import { transaction } from '../db.js'
import { badRequest, notFound, onDuplicate } from '../errors.js'
import { getProject, listProjects } from '../projects.js'
import { parseId, text } from '../validate.js'

const router = Router()
router.use(requireAuth)

const duplicateProject = onDuplicate('A project with this name already exists.')
const duplicateEpisode = onDuplicate('An episode with this name already exists in this project.')

// Everyone needs this: employees pick from active projects on My EOD.
router.get('/', async (req, res) => {
  res.json({ projects: await listProjects() })
})

router.post('/', requireManager, async (req, res) => {
  const name = text(req.body?.name, 'Project name', 120)
  if (!name) throw badRequest('Give the project a name.')

  const project = await transaction(async (client) => {
    const { rows: [row] } = await client.query('INSERT INTO projects (name) VALUES ($1) RETURNING id', [name])
    await client.query(`INSERT INTO episodes (project_id, position, name) VALUES ($1, 0, 'EP 01')`, [row.id])
    return getProject(row.id, client)
  }).catch(duplicateProject)
  res.status(201).json({ project })
})

// Rename and/or archive/restore.
router.patch('/:id', requireManager, async (req, res) => {
  const id = parseId(req.params.id, 'Project')
  const params = [id]
  const updates = []
  if (req.body?.name !== undefined) {
    const name = text(req.body.name, 'Project name', 120)
    if (!name) throw badRequest('Give the project a name.')
    params.push(name)
    updates.push(`name = $${params.length}`)
  }
  if (req.body?.archived !== undefined) {
    if (typeof req.body.archived !== 'boolean') throw badRequest('archived must be true or false.')
    params.push(req.body.archived)
    updates.push(`archived = $${params.length}`)
  }
  if (!updates.length) throw badRequest('Nothing to update. Send name and/or archived.')

  const project = await transaction(async (client) => {
    const { rowCount } = await client.query(`UPDATE projects SET ${updates.join(', ')} WHERE id = $1`, params)
    if (!rowCount) throw notFound('Project not found.')
    return getProject(id, client)
  }).catch(duplicateProject)
  res.json({ project })
})

// "+ Add EP 08" — auto-numbers unless a name is sent.
router.post('/:id/episodes', requireManager, async (req, res) => {
  const id = parseId(req.params.id, 'Project')
  const custom = text(req.body?.name, 'Episode name', 40)

  const project = await transaction(async (client) => {
    const { rowCount } = await client.query('SELECT 1 FROM projects WHERE id = $1 FOR UPDATE', [id])
    if (!rowCount) throw notFound('Project not found.')
    const { rows: [{ count, next }] } = await client.query(
      'SELECT count(*)::int AS count, COALESCE(max(position) + 1, 0) AS next FROM episodes WHERE project_id = $1',
      [id],
    )
    const name = custom || `EP ${String(count + 1).padStart(2, '0')}`
    await client.query('INSERT INTO episodes (project_id, position, name) VALUES ($1, $2, $3)', [id, next, name])
    return getProject(id, client)
  }).catch(duplicateEpisode)
  res.status(201).json({ project })
})

// Inline rename of an episode chip; :index is its place in project.episodes.
router.patch('/:id/episodes/:index', requireManager, async (req, res) => {
  const id = parseId(req.params.id, 'Project')
  const index = Number(req.params.index)
  if (!Number.isInteger(index) || index < 0) throw notFound('Episode not found.')
  const name = text(req.body?.name, 'Episode name', 40)
  if (!name) throw badRequest('Give the episode a name.')

  const project = await transaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE episodes SET name = $3
       WHERE id = (SELECT id FROM episodes WHERE project_id = $1 ORDER BY position OFFSET $2 LIMIT 1)`,
      [id, index, name],
    )
    if (!rowCount) throw notFound('Episode not found.')
    return getProject(id, client)
  }).catch(duplicateEpisode)
  res.json({ project })
})

export default router
