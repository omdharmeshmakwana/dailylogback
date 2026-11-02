import { Router } from 'express'
import { requireAuth, requireManager } from '../auth.js'
import { config } from '../config.js'
import { query } from '../db.js'
import { daysBetween, parseDate, todayKey } from '../dates.js'
import { badRequest } from '../errors.js'
import { filterEntries, loadEods, saveEod, validateEod } from '../eods.js'
import { queryText } from '../validate.js'

const router = Router()
router.use(requireAuth)

// My EOD: the signed-in person's EOD for a day (today by default), plus
// whether the manager has sent them a reminder.
router.get('/me', async (req, res) => {
  const today = todayKey()
  const date = req.query.date ? parseDate(req.query.date) : today
  const [[eod], reminder] = await Promise.all([
    loadEods({ from: date, to: date, employeeIds: [req.user.id] }),
    query('SELECT sent_at FROM reminders WHERE employee_id = $1 AND work_date = $2', [req.user.id, date]),
  ])
  res.json({
    date,
    today,
    eodDue: config.eodDueTime,
    eod: eod || null,
    reminderSentAt: reminder.rows[0]?.sent_at || null,
  })
})

// Submit or edit today's EOD (employees and managers). Sending it again
// replaces the previous version.
router.put('/me', async (req, res) => {
  const date = todayKey()
  const payload = await validateEod(req.body)
  const { created } = await saveEod(req.user.id, date, payload)
  const [eod] = await loadEods({ from: date, to: date, employeeIds: [req.user.id] })
  res.status(created ? 201 : 200).json({ eod })
})

// Manager: EODs in a date range, optionally filtered by employee email,
// project and episode (entries outside the filter are dropped).
router.get('/', requireManager, async (req, res) => {
  const from = req.query.from ? parseDate(req.query.from, 'from') : todayKey()
  const to = req.query.to ? parseDate(req.query.to, 'to') : from
  if (to < from) throw badRequest('to must be on or after from.')
  if (daysBetween(from, to) > 92) throw badRequest('Ask for 92 days or fewer at a time.')

  const employee = queryText(req.query.employee).toLowerCase()
  const project = queryText(req.query.project)
  const episode = project ? queryText(req.query.episode) : ''

  let employeeIds
  if (employee) {
    const { rows } = await query('SELECT id FROM employees WHERE email = $1', [employee])
    employeeIds = rows.map((row) => row.id)
  }

  const eods = (await loadEods({ from, to, employeeIds }))
    .map((eod) => ({ ...eod, entries: filterEntries(eod, { project, episode }) }))
    .filter((eod) => !project || eod.entries.length)
  res.json({ from, to, eods })
})

export default router
