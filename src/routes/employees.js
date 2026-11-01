import { Router } from 'express'
import { requireAuth, requireManager } from '../auth.js'
import { query } from '../db.js'
import { badRequest, notFound, onDuplicate } from '../errors.js'
import { parseId, text } from '../validate.js'

const router = Router()
router.use(requireAuth, requireManager)

const COLUMNS = 'id, name, email, active'

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM employees WHERE role = 'employee' AND removed_at IS NULL ORDER BY created_at, name`,
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

router.patch('/:id', async (req, res) => {
  const params = [parseId(req.params.id, 'Employee')]
  const updates = []
  if (req.body?.name !== undefined) {
    const name = text(req.body.name, 'Name', 120)
    if (!name) throw badRequest('Name is required.')
    params.push(name)
    updates.push(`name = $${params.length}`)
  }
  if (req.body?.active !== undefined) {
    if (typeof req.body.active !== 'boolean') throw badRequest('active must be true or false.')
    params.push(req.body.active)
    updates.push(`active = $${params.length}`)
  }
  if (!updates.length) throw badRequest('Nothing to update. Send name and/or active.')

  const { rows } = await query(
    `UPDATE employees SET ${updates.join(', ')}
     WHERE id = $1 AND role = 'employee' AND removed_at IS NULL
     RETURNING ${COLUMNS}`,
    params,
  )
  if (!rows[0]) throw notFound('Employee not found.')
  res.json({ employee: rows[0] })
})

// "Remove Kishan? Past logs are kept." — soft delete.
router.delete('/:id', async (req, res) => {
  const { rowCount } = await query(
    `UPDATE employees SET removed_at = now(), active = FALSE
     WHERE id = $1 AND role = 'employee' AND removed_at IS NULL`,
    [parseId(req.params.id, 'Employee')],
  )
  if (!rowCount) throw notFound('Employee not found.')
  res.status(204).end()
})

export default router
