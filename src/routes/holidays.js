import { Router } from 'express'
import { requireAuth, requireManager } from '../auth.js'
import { query, transaction } from '../db.js'
import { isWeekend, parseDate } from '../dates.js'
import { badRequest, notFound } from '../errors.js'

const router = Router()
router.use(requireAuth)

router.get('/', async (req, res) => {
  const { rows } = await query('SELECT holiday_date AS date FROM holidays ORDER BY holiday_date')
  res.json({ holidays: rows.map((row) => row.date) })
})

// "Mark holiday for everyone": also clears individual marks for that day.
router.post('/', requireManager, async (req, res) => {
  const date = parseDate(req.body?.date)
  if (isWeekend(date)) throw badRequest('Weekends are already days off. Pick a weekday.')
  await transaction(async (client) => {
    await client.query('DELETE FROM attendance WHERE work_date = $1', [date])
    await client.query('INSERT INTO holidays (holiday_date) VALUES ($1) ON CONFLICT DO NOTHING', [date])
  })
  res.status(201).json({ date })
})

router.delete('/:date', requireManager, async (req, res) => {
  const { rowCount } = await query('DELETE FROM holidays WHERE holiday_date = $1', [parseDate(req.params.date)])
  if (!rowCount) throw notFound('That day is not a holiday.')
  res.status(204).end()
})

export default router
