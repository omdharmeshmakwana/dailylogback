import 'dotenv/config'
import { createHmac } from 'node:crypto'

function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable ${name}. See .env.example.`)
  return value
}

const databaseUrl = required('DATABASE_URL')

const keepAliveUrl = process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || ''

const eodDueTime = process.env.EOD_DUE_TIME || '18:30'
if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(eodDueTime)) throw new Error('EOD_DUE_TIME must look like 18:30.')

export const config = {
  port: Number(process.env.PORT) || 4000,
  databaseUrl,
  // Optional. Without it, tokens are signed with a key derived from
  // DATABASE_URL, which is already secret and survives restarts.
  jwtSecret: process.env.JWT_SECRET || createHmac('sha256', databaseUrl).update('daily-log-jwt').digest('hex'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean),
  timezone: process.env.APP_TIMEZONE || 'Asia/Kolkata',
  eodDueTime,
  // Public URL that src/keepAlive.js pings. Render sets RENDER_EXTERNAL_URL
  // on its own, so this needs no setup there; KEEP_ALIVE_URL=off turns it off.
  keepAliveUrl: keepAliveUrl === 'off' ? '' : keepAliveUrl.replace(/\/$/, ''),
}
