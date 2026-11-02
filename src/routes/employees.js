import { Router } from 'express'
import { requireAuth, requireManager } from '../auth.js'
import { ROLES } from '../constants.js'
import { query } from '../db.js'
import { badRequest, notFound, onDuplicate } from '../errors.js'
import { parseId, text } from '../validate.js'

const router = Router()
router.use(requireAuth, requireManager)

const COLUMNS = 'id, name, email, role, active'

// Everyone with an account, managers first.
router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM employees WHERE removed_at IS NULL ORDER BY role = 'manager' DESC, created_at, name`,
  )
  res.json({ employees: rows })
})

router.post('/', async (req, res) => {
  const name = text(req.body?.name, 'Name', 120)
  const email = text(req.body?.email, 'Email', 254).toLowerCase()
  if (!name || !email) throw badRequest('Name and email are both required.')
  if (!/^\S+@\S+\.\S+$/.test(email)) throw badRequest("That email doesn't look right.")

  const { rows } = await query(
    `INSERT INTO employees (name, email) VALUES ($1, $2) RETURNING ${COLUMNS}`,
    [name, email],
  ).catch(onDuplicate('Someone already uses this email.'))
  res.status(201).json({ employee: rows[0] })
})

// Name, active and role. Managers can't change their own role or deactivate
// themselves, so there is always at least one manager left.
router.patch('/:id', async (req, res) => {
  const id = parseId(req.params.id, 'Employee').toLowerCase()
  const self = id === req.user.id
  const params = [id]
  const updates = []
  if (req.body?.name !== undefined) {
    const name = text(req.body.name, 'Name', 120)
    if (!name) throw badRequest('Name is required.')
    params.push(name)
    updates.push(`name = $${params.length}`)
  }
  if (req.body?.active !== undefined) {
    if (typeof req.body.active !== 'boolean') throw badRequest('active must be true or false.')
    if (self && !req.body.active) throw badRequest("You can't deactivate your own account.")
    params.push(req.body.active)
    updates.push(`active = $${params.length}`)
  }
  if (req.body?.role !== undefined) {
    if (!ROLES.includes(req.body.role)) throw badRequest(`role must be one of ${ROLES.join(', ')}.`)
    if (self && req.body.role !== req.user.role) throw badRequest("You can't change your own role. Ask another manager.")
    params.push(req.body.role)
    updates.push(`role = $${params.length}`)
  }
  if (!updates.length) throw badRequest('Nothing to update. Send name, active and/or role.')

  const { rows } = await query(
    `UPDATE employees SET ${updates.join(', ')}
     WHERE id = $1 AND removed_at IS NULL
     RETURNING ${COLUMNS}`,
    params,
  )
  if (!rows[0]) throw notFound('Employee not found.')
  res.json({ employee: rows[0] })
})

// "Remove Kishan? Past logs are kept." — soft delete.
router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id, 'Employee').toLowerCase()
  if (id === req.user.id) throw badRequest("You can't remove your own account.")
  const { rowCount } = await query(
    `UPDATE employees SET removed_at = now(), active = FALSE
     WHERE id = $1 AND removed_at IS NULL`,
    [id],
  )
  if (!rowCount) throw notFound('Employee not found.')
  res.status(204).end()
})

export default router
