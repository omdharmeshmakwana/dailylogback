// Mirrors frontend/src/data.ts so the API accepts exactly what the UI produces.

export const OUTPUTS = {
  image: ['charsheet', 'location', 'storyboard', 'keyframe'],
  clip: ['clip', 'lipsync', 'extend', 'upscale'],
}
export const OUTPUT_KEYS = [...OUTPUTS.image, ...OUTPUTS.clip]
export const KINDS = ['Fresh', 'Revision', 'Test', 'Trailer', 'Training']
export const STATUSES = ['In progress', 'Sent for approval', 'On hold', 'Done']
export const ROLES = ['employee', 'manager']
export const ATTENDANCE_STATUSES = ['present', 'absent', 'half', 'wfh', 'leave', 'holiday']
export const ATTENDING = ['present', 'half', 'wfh']
export const AWAY = ['absent', 'leave']

// Availability flag read from "Tomorrow's plan" text (same rules as the prototype).
export function planFlag(text) {
  if (/\bleave\b|day off/i.test(text)) return 'leave'
  if (/early|leaving at/i.test(text)) return 'early'
  if (/\blate\b/i.test(text)) return 'late'
  if (/wfh|work(ing)? from home/i.test(text)) return 'wfh'
  return null
}
