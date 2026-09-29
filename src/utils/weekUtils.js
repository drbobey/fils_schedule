const CLASSES_START_DATE = new Date(2026, 8, 28) // Sep 28 (month 0-indexed)

// Winter holiday 19.12.2026 - 10.01.2027 is not counted: continuous calendar
// weeks 13-15 (Mon 21.12, 28.12, 04.01) are shown as free "Winter Holiday"
// weeks. Teaching weeks 1-12 map to continuous weeks 1-12, teaching weeks
// 13-14 map to continuous weeks 16-17 (11.01 - 22.01.2027).
export const HOLIDAY_WEEKS = [13, 14, 15]
const SKIPPED_COUNT = HOLIDAY_WEEKS.length

const WINTER_HOLIDAY_START = new Date(2026, 11, 19) // Dec 19 (month 0-indexed)
const WINTER_HOLIDAY_END = new Date(2027, 0, 10) // Jan 10 (month 0-indexed)

function stripTime(d) {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

export function isHolidayWeek(weekNumber) {
  return HOLIDAY_WEEKS.includes(Number(weekNumber))
}

/** Continuous (navigable) week -> teaching week, or null inside the winter holiday. */
export function continuousWeekToTeachingWeek(weekNumber) {
  const w = Number(weekNumber)
  if (HOLIDAY_WEEKS.includes(w)) return null
  if (w > 15) return w - SKIPPED_COUNT
  return w
}

/** Teaching week (1-14, as stored in schedule.json tests/attendance) -> continuous week. */
export function teachingWeekToContinuousWeek(weekNumber) {
  const w = Number(weekNumber)
  if (w > 12) return w + SKIPPED_COUNT
  return w
}

/** Toolbar title: "Winter Holiday" for holiday weeks, otherwise "Week N" (teaching number). */
export function getWeekTitle(weekNumber) {
  if (isHolidayWeek(weekNumber)) return 'Winter Holiday'
  return `Week ${continuousWeekToTeachingWeek(weekNumber)}`
}

/** True for every calendar day inside 19.12.2026 - 10.01.2027 (shown as free). */
export function isHolidayDate(date) {
  const d = stripTime(date)
  return d >= stripTime(WINTER_HOLIDAY_START) && d <= stripTime(WINTER_HOLIDAY_END)
}

export function getSemesterWeekNumber(date = new Date()) {
  const d = stripTime(date)
  const start = stripTime(CLASSES_START_DATE)
  const diffMs = d.getTime() - start.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
  return Math.max(1, 1 + Math.floor(diffDays / 7))
}

export function getWeekDateRange(weekNumber) {
  const start = new Date(CLASSES_START_DATE)
  start.setHours(0, 0, 0, 0)
  const monday = new Date(start)
  monday.setDate(start.getDate() + (weekNumber - 1) * 7)
  const friday = new Date(monday)
  friday.setDate(monday.getDate() + 4)
  const fmt = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return { monday, friday, label: `${fmt(monday)} – ${fmt(friday)}` }
}

export function getDateForWeekDay(weekNumber, dayIndex) {
  const start = new Date(CLASSES_START_DATE)
  start.setHours(0, 0, 0, 0)
  const monday = new Date(start)
  monday.setDate(start.getDate() + (weekNumber - 1) * 7)
  const d = new Date(monday)
  d.setDate(monday.getDate() + dayIndex)
  return d
}

export const SEMESTER_WEEKS = 17 // 14 teaching weeks + 3 winter-holiday weeks
export const TEACHING_WEEKS = 14

/** When set, only apply start/end/day from weekEntry for this viewer group (others use cls defaults). */
export function getTimeslotNote(weekEntry) {
  if (!weekEntry || typeof weekEntry !== 'object') return ''
  const note = weekEntry.note ?? weekEntry.timeslotNote ?? ''
  return typeof note === 'string' ? note.trim() : ''
}

export function resolveWeekTimeFields(weekEntry, cls, viewerGroup) {
  if (!weekEntry || typeof weekEntry !== 'object') {
    return { day: cls.day, start: cls.start, end: cls.end }
  }
  const g = weekEntry.applyTimesForGroup
  const applies = g == null || g === '' || g === viewerGroup
  return {
    day: applies && weekEntry.day != null ? Number(weekEntry.day) : cls.day,
    start: applies && weekEntry.start ? weekEntry.start : cls.start,
    end: applies && weekEntry.end ? weekEntry.end : cls.end,
  }
}
