import { badRequest, notFound } from './errors.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseId(value, label) {
  if (typeof value !== 'string' || !UUID.test(value)) throw notFound(`${label} not found.`)
  return value
}

// Trimmed text; missing values become ''.
export function text(value, label, max = 2000) {
  if (value == null) return ''
  if (typeof value !== 'string') throw badRequest(`${label} must be text.`)
  const clean = value.trim()
  if (clean.length > max) throw badRequest(`${label} must be ${max} characters or fewer.`)
  return clean
}

// Query-string filters: anything that isn't a single string is ignored.
export function queryText(value) {
  return typeof value === 'string' ? value.trim() : ''
}
