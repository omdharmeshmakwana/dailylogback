import { Router } from 'express'
import { publicUser, requireAuth, signToken } from '../auth.js'
import { query } from '../db.js'
import { HttpError, badRequest } from '../errors.js'

const router = Router()

// Same rule as the Login screen: role comes from the account, and you can
// sign in with your email or just your name ("gauri", "gauri@anything").
router.post('/login', async (req, res) => {
  const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim() : ''
  if (!identifier) throw badRequest('Enter your name or email to continue.')

  const email = identifier.toLowerCase()
  const name = email.split('@')[0].replace(/[._-]+/g, ' ').trim()
  const { rows } = await query(
    `SELECT id, name, email, role, active FROM employees
     WHERE removed_at IS NULL AND (email = $1 OR lower(name) = $2)`,
    [email, name],
  )

  const match = rows.find((row) => row.email === email) || (rows.length === 1 ? rows[0] : null)
  if (!match && rows.length > 1) throw badRequest('More than one person has that name. Sign in with your email instead.')
  if (!match) throw new HttpError(401, "We couldn't find that name or email in the team list.")
  if (!match.active) throw new HttpError(403, `${match.name}'s account is inactive. Ask your manager to reactivate it.`)

  res.json({ token: signToken(match), user: publicUser(match) })
})

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) })
})

export default router
