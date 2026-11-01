import { Router } from 'express'
import { requireAuth, requireManager } from '../auth.js'
import { query } from '../db.js'
import { todayKey } from '../dates.js'
import { badRequest, notFound } from '../errors.js'

const router = Router()

// "Send reminder" / "Remind all" for today's missed EODs. Records who was
// reminded and when; the employee sees it via GET /api/eods/me.
router.post('/', requireAuth, requireManager, async (req, res) => {
  const { emails } = req.body ?? {}
  if (!Array.isArray(emails) || !emails.length || emails.some((email) => typeof email !== 'string')) {
    throw badRequest('Send emails as a list of employee emails.')
  }
  const wanted = [...new Set(emails.map((email) => email.trim().toLowerCase()))]
  const date = todayKey()

  const { rows } = await query(
    `WITH sent AS (
       INSERT INTO reminders (employee_id, work_date, sent_by)
       SELECT id, $2, $3 FROM employees
       WHERE email = ANY($1::text[]) AND role = 'employee' AND active AND removed_at IS NULL
       ON CONFLICT (employee_id, work_date) DO UPDATE SET sent_at = now(), sent_by = EXCLUDED.sent_by
       RETURNING employee_id, sent_at
     )
     SELECT e.name, e.email, s.sent_at AS "sentAt"
     FROM sent s JOIN employees e ON e.id = s.employee_id
     ORDER BY e.created_at, e.name`,
    [wanted, date, req.user.id],
  )
  if (!rows.length) throw notFound('None of those emails belong to an active employee.')

  const found = new Set(rows.map((row) => row.email))
  res.json({ date, sent: rows, unknown: wanted.filter((email) => !found.has(email)) })
})

export default router
