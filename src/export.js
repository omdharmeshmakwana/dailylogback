import { config } from './config.js'
import { CHECK_IN, query } from './db.js'
import { addDays, isWeekend, todayKey } from './dates.js'
import { loadEods } from './eods.js'

// "Export data": EODs and attendance together in one CSV sheet. One row per
// person per day, or one per work line on days with an EOD, each carrying
// that day's attendance. Labels match what the UI shows.

const ATTENDANCE_LABELS = { present: 'Present', absent: 'Absent', half: 'Half day', wfh: 'Work from home', leave: 'Leave', holiday: 'Holiday' }
const OUTPUT_LABELS = {
  charsheet: 'Character sheet', location: 'Location image', storyboard: 'Storyboard', keyframe: 'Keyframe',
  clip: 'Clip from keyframes', lipsync: 'Lip-sync', extend: 'Extend clip', upscale: 'Upscale',
}
const HEADINGS = [
  'Date', 'Day', 'Employee', 'Email', 'Attendance', 'Check-in', 'Attendance note',
  'EOD', 'Submitted', 'Last edited', 'Project', 'Episode', 'Scene', 'Kind', 'Work status', 'Work type', 'Description', 'Outputs', 'Total outputs', "Tomorrow's plan", 'Remarks',
]
const EOD_DETAIL_COLUMNS = HEADINGS.length - HEADINGS.indexOf('EOD') - 1

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' })
const dayName = (key) => WEEKDAY.format(new Date(`${key}T00:00:00Z`))

const STAMP = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
// "2026-11-02 18:12" in APP_TIMEZONE.
const localTime = (value) => STAMP.format(new Date(value)).replace(', ', ' ')

// Free text that a spreadsheet would run as a formula (=, +, @, -cmd) gets a leading '.
function cell(value) {
  let text = value == null ? '' : String(value)
  if (typeof value === 'string' && /^([=+@\t\r]|-(?! ))/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// The BOM makes Excel read names and notes as UTF-8.
const csv = (rows) => `﻿${[HEADINGS, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`

export async function exportSheet() {
  const today = todayKey()
  const [people, records, holidays, eods] = await Promise.all([
    query(
      `SELECT id, name, email, (created_at AT TIME ZONE $1)::date AS added
       FROM employees WHERE role = 'employee' AND active AND removed_at IS NULL`,
      [config.timezone],
    ),
    query(
      `SELECT a.employee_id, e.name, e.email, a.work_date AS date, a.status, ${CHECK_IN} AS check_in
       FROM attendance a JOIN employees e ON e.id = a.employee_id`,
    ),
    query('SELECT holiday_date AS date FROM holidays'),
    loadEods({ from: '2000-01-01', to: '9999-12-31' }),
  ])

  // Person-days: each active employee's working days since they were added
  // (the Attendance page's rule), every marked day, and every EOD by anyone.
  const days = new Map()
  const day = (id, date, name, email) => {
    const key = `${id}|${date}`
    if (!days.has(key)) days.set(key, { date, name, email, record: null, eod: null })
    return days.get(key)
  }
  for (const person of people.rows) {
    for (let date = person.added; date <= today; date = addDays(date, 1)) {
      if (!isWeekend(date)) day(person.id, date, person.name, person.email)
    }
  }
  for (const row of records.rows) day(row.employee_id, row.date, row.name, row.email).record = row
  for (const eod of eods) day(eod.employee.id, eod.date, eod.employee.name, eod.employee.email).eod = eod

  // Unmarked working days count as present, as on the Attendance page.
  const holidayDays = new Set(holidays.rows.map((row) => row.date))
  const attendance = ({ date, record }) => {
    if (record) return [ATTENDANCE_LABELS[record.status], record.check_in, 'Marked']
    if (isWeekend(date)) return ['Weekend', '', '']
    if (holidayDays.has(date)) return ['Holiday', '', 'Studio holiday']
    return ['Present', '', 'Not marked (counts as present)']
  }

  const rows = []
  const sorted = [...days.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
  for (const entry of sorted) {
    const head = [entry.date, dayName(entry.date), entry.name, entry.email, ...attendance(entry)]
    const { eod } = entry
    if (!eod) {
      rows.push([...head, entry.date > today ? '' : 'Not submitted', ...Array(EOD_DETAIL_COLUMNS).fill('')])
      continue
    }
    const submitted = [...head, 'Submitted', localTime(eod.submittedAt), localTime(eod.updatedAt)]
    const notes = [eod.plan, eod.remarks]
    const lines = eod.entries.flatMap((scene) => scene.lines.map((line) => [scene, line]))
    if (!lines.length) rows.push([...submitted, ...Array(EOD_DETAIL_COLUMNS - 4).fill(''), ...notes])
    for (const [scene, line] of lines) {
      const outputs = line.items.map((item) => `${OUTPUT_LABELS[item.k]} ${item.count}`).join('; ')
      const total = line.items.reduce((sum, item) => sum + item.count, 0)
      rows.push([...submitted, scene.project, scene.episode, scene.scene, scene.kind, scene.status, line.type === 'clip' ? 'Clip' : 'Image', line.text, outputs, total, ...notes])
    }
  }
  return { filename: `daily-log-export-${today}.csv`, data: csv(rows) }
}
