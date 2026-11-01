import { Router } from 'express'
import { requireAuth, requireManager } from '../auth.js'
import { ATTENDANCE_STATUSES } from '../constants.js'
import { CHECK_IN, query } from '../db.js'
import { monthRange, parseDate, parseMonth, todayKey } from '../dates.js'
import { badRequest, notFound } from '../errors.js'

const router = Router()
router.use(requireAuth, requireManager)

const TIME = /^((0?[1-9]|1[0-2]):[0-5]\d\s?[ap]m|([01]?\d|2[0-3]):[0-5]\d)$/i

// Month grid: active employees, their marked days and studio holidays.
// Unmarked days are left out; the client decides how to show them.
router.get('/', async (req, res) => {
  const month = req.query.month ? parseMonth(req.query.month) : todayKey().slice(0, 7)
  const { from, to } = monthRange(month)
  const [people, records, holidays] = await Promise.all([
    query(`SELECT id, name, email FROM employees WHERE role = 'employee' AND active AND removed_at IS NULL ORDER BY created_at, name`),
    query(
      `SELECT e.email, a.work_date AS date, a.status, ${CHECK_IN} AS "checkIn"
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       WHERE a.work_date BETWEEN $1 AND $2 AND e.active AND e.removed_at IS NULL
       ORDER BY a.work_date, e.email`,
      [from, to],
    ),
    query('SELECT holiday_date AS date FROM holidays WHERE holiday_date BETWEEN $1 AND $2 ORDER BY holiday_date', [from, to]),
  ])
  res.json({
    month,
    today: todayKey(),
    employees: people.rows,
    records: records.rows,
    holidays: holidays.rows.map((row) => row.date),
  })
})

// Set one cell. status: present | absent | half | wfh | leave | holiday,
// or null to clear the mark. checkIn is optional ("9:41 AM" or "09:41") and
// only kept for present / half day / WFH.
router.put('/', async (req, res) => {
  const { email, status, checkIn } = req.body ?? {}
  const date = parseDate(req.body?.date)
  if (status !== null && !ATTENDANCE_STATUSES.includes(status)) {
    throw badRequest(`status must be one of ${ATTENDANCE_STATUSES.join(', ')}, or null to clear.`)
  }
  if (checkIn != null && checkIn !== '' && (typeof checkIn !== 'string' || !TIME.test(checkIn.trim()))) {
    throw badRequest('checkIn must be a time like 9:41 AM or 09:41.')
  }

  const { rows: [person] } = await query(
    `SELECT id, email FROM employees WHERE email = $1 AND role = 'employee' AND removed_at IS NULL`,
    [typeof email === 'string' ? email.trim().toLowerCase() : ''],
  )
  if (!person) throw notFound('Employee not found.')

  if (status === null) {
    await query('DELETE FROM attendance WHERE employee_id = $1 AND work_date = $2', [person.id, date])
    res.json({ record: null })
    return
  }

  const { rows: [record] } = await query(
    `INSERT INTO attendance AS a (employee_id, work_date, status, check_in)
     VALUES ($1, $2, $3, CASE WHEN $3 IN ('present', 'half', 'wfh') THEN $4::time END)
     ON CONFLICT (employee_id, work_date) DO UPDATE SET
       status = EXCLUDED.status,
       check_in = CASE WHEN EXCLUDED.status IN ('present', 'half', 'wfh') THEN COALESCE(EXCLUDED.check_in, a.check_in) END,
       updated_at = now()
     RETURNING work_date AS date, status, ${CHECK_IN} AS "checkIn"`,
    [person.id, date, status, checkIn ? checkIn.trim() : null],
  )
  res.json({ record: { email: person.email, ...record } })
})

export default router
