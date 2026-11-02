import { Router } from 'express'
import { requireAuth, requireManager } from '../auth.js'
import { config } from '../config.js'
import { ATTENDING, AWAY, OUTPUT_KEYS, planFlag } from '../constants.js'
import { CHECK_IN, query } from '../db.js'
import { isWeekend, parseDate, periodStart, todayKey } from '../dates.js'
import { badRequest } from '../errors.js'
import { countOutputs, filterEntries, loadEods } from '../eods.js'
import { listProjects } from '../projects.js'
import { queryText } from '../validate.js'

const router = Router()

// Everything the manager Dashboard shows, computed for one day (summary, feed,
// missed, notes) and for the selected period (output tiles, breakdown).
//
// Query: date=YYYY-MM-DD  period=day|week|month  project  episode  employee (email)
router.get('/', requireAuth, requireManager, async (req, res) => {
  const today = todayKey()
  const requested = req.query.date ? parseDate(req.query.date) : today
  const date = requested > today ? today : requested
  const period = queryText(req.query.period) || 'day'
  if (!['day', 'week', 'month'].includes(period)) throw badRequest('period must be day, week or month.')
  const project = queryText(req.query.project)
  const episode = project ? queryText(req.query.episode) : ''
  const employee = queryText(req.query.employee).toLowerCase()
  const start = periodStart(date, period)

  // Inactive and removed people are left out of the dashboard entirely.
  // Managers are included so their EODs show, but see the summary below.
  const { rows: people } = await query(
    `SELECT id, name, email, role FROM employees
     WHERE active AND removed_at IS NULL ${employee ? 'AND email = $1' : ''}
     ORDER BY created_at, name`,
    employee ? [employee] : [],
  )
  const ids = people.map((person) => person.id)

  const [eods, attendance, holiday, reminders, projects] = await Promise.all([
    loadEods({ from: start, to: date, employeeIds: ids }),
    query(`SELECT employee_id, status, ${CHECK_IN} AS check_in FROM attendance WHERE work_date = $1 AND employee_id = ANY($2::uuid[])`, [date, ids]),
    query('SELECT 1 FROM holidays WHERE holiday_date = $1', [date]),
    query('SELECT employee_id, sent_at FROM reminders WHERE work_date = $1 AND employee_id = ANY($2::uuid[])', [date, ids]),
    listProjects(),
  ])

  const weekend = isWeekend(date)
  const isHoliday = holiday.rowCount > 0
  const noWork = weekend ? "It's a weekend. No EODs expected." : isHoliday ? 'Studio holiday. No EODs expected.' : ''
  const attendanceBy = new Map(attendance.rows.map((row) => [row.employee_id, row]))
  const remindedBy = new Map(reminders.rows.map((row) => [row.employee_id, row.sent_at]))
  const dayEods = eods.filter((eod) => eod.date === date)
  const eodBy = new Map(dayEods.map((eod) => [eod.employee.id, eod]))

  // A working day with no attendance mark means the person is expected in.
  // Submitting an EOD always counts as present. EODs are optional for
  // managers: they count only on days they submit one, and are never missed.
  let counted = 0
  let present = 0
  let away = 0
  let submitted = 0
  const missed = []
  for (const person of people) {
    const hasEod = eodBy.has(person.id)
    if (person.role === 'manager' && !hasEod) continue
    counted += 1
    const record = attendanceBy.get(person.id)
    const status = record?.status ?? (weekend ? null : isHoliday ? 'holiday' : 'present')
    if (ATTENDING.includes(status) || hasEod) {
      present += 1
      if (hasEod) submitted += 1
      else missed.push({ id: person.id, name: person.name, email: person.email, status, checkIn: record?.check_in ?? null, reminderSentAt: remindedBy.get(person.id) ?? null })
    } else if (AWAY.includes(status)) {
      away += 1
    }
  }

  // Output tiles and the project → episode breakdown, over the whole period.
  const outputs = Object.fromEntries(OUTPUT_KEYS.map((key) => [key, 0]))
  const byProject = new Map()
  for (const eod of eods) {
    for (const entry of filterEntries(eod, { project, episode })) {
      if (!byProject.has(entry.project)) byProject.set(entry.project, new Map())
      const episodes = byProject.get(entry.project)
      if (!episodes.has(entry.episode)) episodes.set(entry.episode, { images: 0, clips: 0 })
      const totals = episodes.get(entry.episode)
      for (const line of entry.lines) {
        for (const item of line.items) {
          outputs[item.k] += item.count
          totals[line.type === 'image' ? 'images' : 'clips'] += item.count
        }
      }
    }
  }

  let maxEpisode = 1
  for (const episodes of byProject.values()) {
    for (const totals of episodes.values()) maxEpisode = Math.max(maxEpisode, totals.images + totals.clips)
  }
  const breakdown = projects.filter((item) => byProject.has(item.name)).map((item) => {
    const totals = byProject.get(item.name)
    const episodes = item.episodes.filter((name) => totals.has(name)).map((name) => {
      const { images, clips } = totals.get(name)
      return { episode: name, images, clips, total: images + clips, share: Math.round(((images + clips) / maxEpisode) * 100) }
    })
    const images = episodes.reduce((sum, row) => sum + row.images, 0)
    const clips = episodes.reduce((sum, row) => sum + row.clips, 0)
    return { project: item.name, images, clips, total: images + clips, episodes }
  })

  // Team feed: the selected day only, entries narrowed to the filters.
  const feed = dayEods
    .map((eod) => {
      const entries = filterEntries(eod, { project, episode })
      return {
        employee: eod.employee,
        submittedAt: eod.submittedAt,
        updatedAt: eod.updatedAt,
        scenes: entries.length,
        outputs: countOutputs(entries),
        entries,
      }
    })
    .filter((item) => item.entries.length)

  // Notes: flagged availability first (On leave, Leaving early, Coming late, WFH).
  const plans = dayEods
    .filter((eod) => eod.plan)
    .map((eod) => ({ name: eod.employee.name, email: eod.employee.email, text: eod.plan, flag: planFlag(eod.plan) }))
    .sort((a, b) => Number(!a.flag) - Number(!b.flag))
  const remarks = dayEods
    .filter((eod) => eod.remarks)
    .map((eod) => ({ name: eod.employee.name, email: eod.employee.email, text: eod.remarks }))

  res.json({
    date,
    today,
    isToday: date === today,
    period,
    periodStart: start,
    periodEnd: date,
    eodDue: config.eodDueTime,
    noWork,
    summary: {
      people: counted,
      present,
      away,
      submitted,
      missed: missed.length,
      submittedPercent: present ? Math.round((submitted / present) * 100) : null,
    },
    outputs,
    totalOutputs: Object.values(outputs).reduce((sum, value) => sum + value, 0),
    breakdown,
    feed,
    missed,
    plans,
    remarks,
  })
})

export default router
