import { KINDS, OUTPUT_KEYS, OUTPUTS, STATUSES, planFlag } from './constants.js'
import { pool, transaction } from './db.js'
import { badRequest } from './errors.js'
import { projectLookup } from './projects.js'
import { text } from './validate.js'

// Loads full EODs (entries → lines → items) shaped like the frontend's
// SceneEntry / LineItem types. Project and episode come back as names.
export async function loadEods({ from, to, employeeIds }, db = pool) {
  const params = [from, to, OUTPUT_KEYS]
  if (employeeIds) params.push(employeeIds)
  const { rows } = await db.query(`
    SELECT e.id AS eod_id, e.work_date, e.remarks, e.plan, e.submitted_at, e.updated_at,
           emp.id AS employee_id, emp.name AS employee_name, emp.email AS employee_email,
           en.id AS entry_id, p.name AS project, ep.name AS episode, en.scene, en.kind, en.status,
           l.id AS line_id, l.work_type, l.description,
           li.output_key, li.count
    FROM eods e
    JOIN employees emp ON emp.id = e.employee_id
    LEFT JOIN eod_entries en ON en.eod_id = e.id
    LEFT JOIN projects p ON p.id = en.project_id
    LEFT JOIN episodes ep ON ep.id = en.episode_id
    LEFT JOIN eod_lines l ON l.entry_id = en.id
    LEFT JOIN eod_line_items li ON li.line_id = l.id
    WHERE e.work_date BETWEEN $1 AND $2
      ${employeeIds ? 'AND e.employee_id = ANY($4::uuid[])' : ''}
    ORDER BY e.work_date, e.submitted_at, e.id, en.position, l.position, array_position($3::text[], li.output_key)`,
  params)

  const eods = new Map()
  for (const row of rows) {
    let eod = eods.get(row.eod_id)
    if (!eod) {
      eod = {
        id: row.eod_id,
        date: row.work_date,
        employee: { id: row.employee_id, name: row.employee_name, email: row.employee_email },
        remarks: row.remarks,
        plan: row.plan,
        planFlag: planFlag(row.plan),
        submittedAt: row.submitted_at,
        updatedAt: row.updated_at,
        entries: [],
      }
      eods.set(row.eod_id, eod)
    }
    if (!row.entry_id) continue

    let entry = eod.entries.at(-1)
    if (entry?.id !== row.entry_id) {
      entry = { id: row.entry_id, project: row.project, episode: row.episode, scene: row.scene, kind: row.kind, status: row.status, lines: [] }
      eod.entries.push(entry)
    }
    if (!row.line_id) continue

    let line = entry.lines.at(-1)
    if (line?.id !== row.line_id) {
      line = { id: row.line_id, type: row.work_type, items: [], text: row.description }
      entry.lines.push(line)
    }
    if (row.output_key) line.items.push({ k: row.output_key, count: row.count })
  }
  return [...eods.values()]
}

export function filterEntries(eod, { project, episode }) {
  return eod.entries.filter((entry) => (!project || entry.project === project) && (!episode || entry.episode === episode))
}

export function countOutputs(entries) {
  return entries.reduce(
    (sum, entry) => sum + entry.lines.reduce((lineSum, line) => lineSum + line.items.reduce((itemSum, item) => itemSum + item.count, 0), 0),
    0,
  )
}

// Same rules as the "Submit EOD" validation in the UI. Messages name the
// scene entry and line so the client can show them as-is.
export async function validateEod(body) {
  if (!body || typeof body !== 'object') throw badRequest('Send the EOD as JSON.')
  const { entries } = body
  if (!Array.isArray(entries) || !entries.length) throw badRequest('Add at least one scene entry.')
  if (entries.length > 30) throw badRequest('An EOD can have at most 30 scene entries.')

  const projects = await projectLookup()
  const clean = entries.map((entry, index) => {
    const fail = (message) => badRequest(`Scene entry ${index + 1}: ${message}`)
    if (!entry || typeof entry !== 'object') throw fail('must be an object.')
    if (!entry.project) throw fail('Choose a project.')
    const project = projects.get(entry.project)
    if (!project) throw fail(`There is no project called "${entry.project}".`)
    if (project.archived) throw fail(`${project.name} is archived. Pick an active project.`)
    if (!entry.episode) throw fail('Choose an episode.')
    const episodeId = project.episodes.get(entry.episode)
    if (!episodeId) throw fail(`${project.name} has no episode called "${entry.episode}".`)
    if (!KINDS.includes(entry.kind)) throw fail('Choose the kind of work.')
    if (!STATUSES.includes(entry.status)) throw fail('Choose a status.')
    if (!Array.isArray(entry.lines) || !entry.lines.length) throw fail('Add at least one line: pick outputs, describe them, then Save.')
    if (entry.lines.length > 50) throw fail('A scene entry can have at most 50 lines.')

    const lines = entry.lines.map((line, lineIndex) => {
      const lineFail = (message) => fail(`line ${lineIndex + 1}: ${message}`)
      if (!line || !OUTPUTS[line.type]) throw lineFail('type must be image or clip.')
      const description = text(line.text, `Scene entry ${index + 1} line ${lineIndex + 1}`, 1000)
      if (!description) throw lineFail('Describe what you made today.')
      if (!Array.isArray(line.items) || !line.items.length) throw lineFail('Pick at least one output.')
      const seen = new Set()
      const items = line.items.map((item) => {
        if (!item || !OUTPUTS[line.type].includes(item.k)) throw lineFail(`"${item?.k}" is not a ${line.type} output.`)
        if (seen.has(item.k)) throw lineFail(`${item.k} is listed twice.`)
        seen.add(item.k)
        if (!Number.isInteger(item.count) || item.count < 1 || item.count > 999) throw lineFail('Counts must be whole numbers from 1 to 999.')
        return { k: item.k, count: item.count }
      })
      return { type: line.type, text: description, items }
    })

    return {
      projectId: project.id,
      episodeId,
      scene: text(entry.scene, `Scene entry ${index + 1} scene`, 200),
      kind: entry.kind,
      status: entry.status,
      lines,
    }
  })

  return {
    entries: clean,
    remarks: text(body.remarks, 'Remarks'),
    plan: text(body.plan, "Tomorrow's plan"),
  }
}

// Creates or replaces one employee's EOD for a day. submitted_at keeps the
// first submission time; updated_at tracks later edits.
export function saveEod(employeeId, date, { entries, remarks, plan }) {
  return transaction(async (client) => {
    const { rows: [eod] } = await client.query(`
      INSERT INTO eods (employee_id, work_date, remarks, plan)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (employee_id, work_date)
      DO UPDATE SET remarks = EXCLUDED.remarks, plan = EXCLUDED.plan, updated_at = now()
      RETURNING id, (xmax = 0) AS created`,
    [employeeId, date, remarks, plan])

    await client.query('DELETE FROM eod_entries WHERE eod_id = $1', [eod.id])

    for (const [position, entry] of entries.entries()) {
      const { rows: [entryRow] } = await client.query(`
        INSERT INTO eod_entries (eod_id, position, project_id, episode_id, scene, kind, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id`,
      [eod.id, position, entry.projectId, entry.episodeId, entry.scene, entry.kind, entry.status])

      for (const [linePosition, line] of entry.lines.entries()) {
        const { rows: [lineRow] } = await client.query(`
          INSERT INTO eod_lines (entry_id, position, work_type, description)
          VALUES ($1, $2, $3, $4)
          RETURNING id`,
        [entryRow.id, linePosition, line.type, line.text])

        await client.query(`
          INSERT INTO eod_line_items (line_id, output_key, count)
          SELECT $1, k, c FROM unnest($2::text[], $3::int[]) AS t (k, c)`,
        [lineRow.id, line.items.map((item) => item.k), line.items.map((item) => item.count)])
      }
    }

    return { created: eod.created }
  })
}
