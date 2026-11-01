import cors from 'cors'
import express from 'express'
import { config } from './config.js'
import { pool, query } from './db.js'
import { todayKey } from './dates.js'
import { HttpError } from './errors.js'
import attendanceRoutes from './routes/attendance.js'
import authRoutes from './routes/auth.js'
import dashboardRoutes from './routes/dashboard.js'
import employeeRoutes from './routes/employees.js'
import eodRoutes from './routes/eods.js'
import holidayRoutes from './routes/holidays.js'
import projectRoutes from './routes/projects.js'
import reminderRoutes from './routes/reminders.js'

const app = express()
app.set('trust proxy', 1)
app.disable('x-powered-by')

// CORS_ORIGIN is a comma-separated list. Entries may use * for one subdomain
// label (https://daily-log-*.vercel.app) to allow Vercel preview deployments.
const escape = (value) => value.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
const allowedOrigins = config.corsOrigins.includes('*')
  ? true
  : config.corsOrigins.map((origin) => (origin.includes('*') ? new RegExp(`^${origin.split('*').map(escape).join('[^./]*')}$`) : origin))
app.use(cors({ origin: allowedOrigins }))
app.use(express.json({ limit: '200kb' }))

app.get('/', (req, res) => {
  res.json({ name: 'Daily Log API', health: '/api/health' })
})

// Render health check. Also wakes a suspended Neon compute.
app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1')
    res.json({ ok: true, database: 'up' })
  } catch (error) {
    console.error('Health check failed:', error.message)
    res.status(503).json({ ok: false, database: 'down' })
  }
})

// Public settings the UI needs before sign-in.
app.get('/api/config', (req, res) => {
  res.json({ today: todayKey(), timezone: config.timezone, eodDue: config.eodDueTime })
})

app.use('/api/auth', authRoutes)
app.use('/api/employees', employeeRoutes)
app.use('/api/projects', projectRoutes)
app.use('/api/eods', eodRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/attendance', attendanceRoutes)
app.use('/api/holidays', holidayRoutes)
app.use('/api/reminders', reminderRoutes)

app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}.` })
})

// Express 5 forwards rejected promises from async handlers here.
app.use((error, req, res, next) => {
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message })
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must be valid JSON.' })
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' })
  // Postgres: invalid text / datetime input.
  if (['22P02', '22007', '22008'].includes(error.code)) return res.status(400).json({ error: 'One of the values in this request is not valid.' })
  console.error(error)
  res.status(500).json({ error: 'Something went wrong on our side. Try again.' })
})

const server = app.listen(config.port, () => {
  console.log(`Daily Log API listening on port ${config.port} (timezone ${config.timezone}, today ${todayKey()})`)
})

// Render sends SIGTERM on every deploy; finish in-flight requests first.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => pool.end().finally(() => process.exit(0)))
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}
