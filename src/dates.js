import { config } from './config.js'
import { badRequest } from './errors.js'

// All dates are 'YYYY-MM-DD' keys. Arithmetic runs in UTC so the host's own
// timezone never matters; "today" is decided by APP_TIMEZONE.

const toUtc = (key) => {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}
const fromUtc = (date) => date.toISOString().slice(0, 10)

export function todayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function isDateKey(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && fromUtc(toUtc(value)) === value
}

export function parseDate(value, label = 'date') {
  if (!isDateKey(value)) throw badRequest(`${label} must be a date like 2026-10-29.`)
  return value
}

export function parseMonth(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw badRequest('month must look like 2026-10.')
  return value
}

export function isWeekend(key) {
  const day = toUtc(key).getUTCDay()
  return day === 0 || day === 6
}

export function addDays(key, days) {
  const date = toUtc(key)
  date.setUTCDate(date.getUTCDate() + days)
  return fromUtc(date)
}

export function daysBetween(from, to) {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000)
}

export function monthRange(month) {
  const [year, monthIndex] = month.split('-').map(Number)
  return { from: `${month}-01`, to: fromUtc(new Date(Date.UTC(year, monthIndex, 0))) }
}

// Week starts on Monday, matching the dashboard's "Week" period.
export function periodStart(key, period) {
  if (period === 'week') return addDays(key, -((toUtc(key).getUTCDay() + 6) % 7))
  if (period === 'month') return `${key.slice(0, 8)}01`
  return key
}
