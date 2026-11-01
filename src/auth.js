import jwt from 'jsonwebtoken'
import { config } from './config.js'
import { query } from './db.js'
import { HttpError } from './errors.js'

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn })
}

export function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role }
}

// Re-reads the account on every request so deactivating or removing someone
// takes effect immediately, not when their token expires.
export async function requireAuth(req, res, next) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) throw new HttpError(401, 'Sign in to continue.')

  let payload
  try {
    payload = jwt.verify(token, config.jwtSecret)
  } catch {
    throw new HttpError(401, 'Your session has expired. Sign in again.')
  }

  const { rows } = await query(
    'SELECT id, name, email, role, active FROM employees WHERE id = $1 AND removed_at IS NULL',
    [payload.sub],
  )
  const user = rows[0]
  if (!user) throw new HttpError(401, 'This account no longer exists.')
  if (!user.active) throw new HttpError(403, `${user.name}'s account is inactive. Ask your manager to reactivate it.`)
  req.user = user
  next()
}

export function requireManager(req, res, next) {
  if (req.user?.role !== 'manager') throw new HttpError(403, 'Only the manager can do that.')
  next()
}
