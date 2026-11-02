import { createHmac } from 'node:crypto'
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { requireAuth, requireManager } from '../auth.js'
import { config } from '../config.js'
import { addDays, todayKey } from '../dates.js'
import { query } from '../db.js'
import { exportSheet } from '../export.js'

const router = Router()

// Emailed download links are signed with their own key, so a link can never
// be used as a sign-in token (and a sign-in token is not a link).
const LINK_KEY = createHmac('sha256', config.jwtSecret).update('daily-log-export-link').digest('hex')
const LINK_DAYS = 7

// Download from an emailed link. Opened straight in a browser tab, so
// failures are plain text for a person to read, not JSON.
router.get('/download', async (req, res) => {
  let payload
  try {
    payload = jwt.verify(String(req.query.token ?? ''), LINK_KEY)
  } catch (error) {
    const expired = error instanceof jwt.TokenExpiredError
    res.status(expired ? 410 : 404).type('text').send(
      expired ? 'This download link has expired. Ask the manager to send a new one.' : 'This download link is not valid.',
    )
    return
  }
  // The link stops working if whoever sent it is no longer an active manager.
  const { rows } = await query(
    `SELECT 1 FROM employees WHERE id = $1 AND role = 'manager' AND active AND removed_at IS NULL`,
    [payload.sub],
  )
  if (!rows.length) {
    res.status(403).type('text').send('This download link is no longer valid.')
    return
  }
  const { filename, data } = await exportSheet()
  res.attachment(filename).send(data)
})

router.use(requireAuth, requireManager)

// EODs and attendance as one CSV sheet.
router.get('/', async (req, res) => {
  const { filename, data } = await exportSheet()
  res.attachment(filename).send(data)
})

// A link to the latest export that works for 7 days without signing in,
// for sending by email. Each download builds a fresh export.
router.post('/link', (req, res) => {
  const token = jwt.sign({}, LINK_KEY, { subject: req.user.id, expiresIn: `${LINK_DAYS}d` })
  const today = todayKey()
  res.status(201).json({
    url: `${req.protocol}://${req.get('host')}/api/export/download?token=${token}`,
    today,
    expires: addDays(today, LINK_DAYS),
  })
})

export default router
