import { config } from './config.js'
import { CHECK_IN, query } from './db.js'
import { addDays, isWeekend, todayKey } from './dates.js'
import { loadEods } from './eods.js'
import { listProjects } from './projects.js'
import { zip } from './zip.js'

// "Export data": everything in the database as one CSV per area, zipped.
// Labels match what the UI shows.

const ATTENDANCE_LABELS = { present: 'Present', absent: 'Absent', half: 'Half day', wfh: 'Work from home', leave: 'Leave', holiday: 'Holiday' }
const OUTPUT_LABELS = {
  charsheet: 'Character sheet', location: 'Location image', storyboard: 'Storyboard', keyframe: 'Keyframe',
  clip: 'Clip from keyframes', lipsync: 'Lip-sync', extend: 'Extend clip', upscale: 'Upscale',
}

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
const csv = (headings, rows) => `﻿${[headings, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`

async function eodLogs() {
  // Every EOD ever submitted; one row per work line so each output is visible.
  const eods = await loadEods({ from: '2000-01-01', to: '9999-12-31' })
  const rows = []
  for (const eod of eods) {
    const head = [eod.date, eod.employee.name, eod.employee.email, localTime(eod.submittedAt), localTime(eod.updatedAt)]
    const notes = [eod.plan, eod.remarks]
    if (!eod.entries.length) rows.push([...head, '', '', '', '', '', '', '', '', '', ...notes])
    for (const entry of eod.entries) {
      for (const line of entry.lines) {
        const outputs = line.items.map((item) => `${OUTPUT_LABELS[item.k]} ${item.count}`).join('; ')
        const total = line.items.reduce((sum, item) => sum + item.count, 0)
        const type = line.type === 'clip' ? 'Clip' : 'Image'
        rows.push([...head, entry.project, entry.episode, entry.scene, entry.kind, entry.status, type, line.text, outputs, total, ...notes])
      }
    }
  }
  return csv(
    ['Date', 'Employee', 'Email', 'Submitted', 'Last edited', 'Project', 'Episode', 'Scene', 'Kind', 'Status', 'Work type', 'Description', 'Outputs', 'Total outputs', "Tomorrow's plan", 'Remarks'],
    rows,
  )
}

// Marked days for everyone, plus each active employee's unmarked working days
// since they were added, which count as present (the Attendance page's rule).
async function attendance(today) {
  const [people, records, holidays] = await Promise.all([
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
  ])
  const marked = new Set(records.rows.map((row) => `${row.employee_id}|${row.date}`))
  const holidayDays = new Set(holidays.rows.map((row) => row.date))

  const rows = records.rows.map((row) => [row.date, dayName(row.date), row.name, row.email, ATTENDANCE_LABELS[row.status], row.check_in, 'Marked'])
  for (const person of people.rows) {
    for (let date = person.added; date <= today; date = addDays(date, 1)) {
      if (isWeekend(date) || marked.has(`${person.id}|${date}`)) continue
      const holiday = holidayDays.has(date)
      rows.push([date, dayName(date), person.name, person.email, holiday ? 'Holiday' : 'Present', '', holiday ? 'Studio holiday' : 'Not marked (counts as present)'])
    }
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2]))
  return csv(['Date', 'Day', 'Employee', 'Email', 'Status', 'Check-in', 'Source'], rows)
}

async function employees() {
  const { rows } = await query(
    `SELECT name, email, role, active, (created_at AT TIME ZONE $1)::date AS added, (removed_at AT TIME ZONE $1)::date AS removed
     FROM employees ORDER BY role DESC, created_at, name`,
    [config.timezone],
  )
  return csv(
    ['Name', 'Email', 'Role', 'Status', 'Added on', 'Removed on'],
    rows.map((row) => [
      row.name, row.email, row.role === 'manager' ? 'Manager' : 'Employee',
      row.removed ? 'Removed' : row.active ? 'Active' : 'Inactive', row.added, row.removed,
    ]),
  )
}

async function projects() {
  const rows = await listProjects()
  return csv(['Project', 'Status', 'Episodes'], rows.map((row) => [row.name, row.archived ? 'Archived' : 'Active', row.episodes.join('; ')]))
}

async function holidays() {
  const { rows } = await query('SELECT holiday_date AS date FROM holidays ORDER BY holiday_date')
  return csv(['Date', 'Day'], rows.map((row) => [row.date, dayName(row.date)]))
}

export async function exportZip() {
  const now = localTime(Date.now())
  const contents = await Promise.all([eodLogs(), attendance(todayKey()), employees(), projects(), holidays()])
  const names = ['eod-logs.csv', 'attendance.csv', 'employees.csv', 'projects.csv', 'holidays.csv']
  return {
    filename: `daily-log-export-${now.slice(0, 10)}.zip`,
    // Zip timestamps have no timezone, so stamp the files with local wall-clock time.
    data: zip(names.map((name, index) => ({ name, content: contents[index] })), new Date(`${now.replace(' ', 'T')}:00Z`)),
  }
}
