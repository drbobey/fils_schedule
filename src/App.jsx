import { useState, useMemo, useEffect, useLayoutEffect, useRef } from 'react'
import scheduleData from './data/schedule.json'
import changelogData from './data/changelog.json'
import Calendar from './components/Calendar'
import { getSemesterWeekNumber, getWeekDateRange, getDateForWeekDay, SEMESTER_WEEKS, resolveWeekTimeFields, getTimeslotNote, isHolidayWeek, isHolidayDate, continuousWeekToTeachingWeek, teachingWeekToContinuousWeek, getWeekTitle } from './utils/weekUtils'
import renderNoteText from './utils/renderNoteText'
import { downloadCalendarEvent, downloadCalendarEvents } from './utils/calendarUtils'
import './App.css'

function toDateKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseDateTime(dateKey, time = '00:00') {
  return new Date(`${dateKey}T${time}:00`)
}

function getWeekEntry(attendanceByWeek, className, weekNumber) {
  return attendanceByWeek?.[className]?.[String(weekNumber)]
}

function shouldShowOnDemandClass(cls, weekNumber, group, attendanceByWeek) {
  const weekEntry = getWeekEntry(attendanceByWeek, cls.name, weekNumber)
  if (!weekEntry) return false
  if (typeof weekEntry === 'object' && weekEntry.group != null && weekEntry.group !== '') return weekEntry.group === group
  return true
}

function shouldShowBiWeeklyClass(cls, weekNumber) {
  const start = cls.biWeeklyFromWeek
  if (start == null) return true
  return weekNumber >= start && (weekNumber - start) % 2 === 0
}

const EXAM_PERIOD_START = '2027-01-23'
const EXAM_PERIOD_END = '2027-02-12'
const TENTATIVE_EXAM_TOOLTIP = 'This date is not final and is subject to changes.'

function isGroupMatch(itemGroup, selectedGroup) {
  if (!itemGroup || itemGroup === 'both') return true
  return itemGroup === selectedGroup
}

function getExamTimeLabel(exam) {
  const start = typeof exam?.start === 'string' ? exam.start.trim() : ''
  const end = typeof exam?.end === 'string' ? exam.end.trim() : ''
  if (start.includes('/')) return start
  if (start && end) return `${start}/${end}`
  return start || ''
}

function buildExamMonthGridForRange(year, monthIndex, rangeStart, rangeEnd, weekdaysOnly) {
  const monthStart = new Date(year, monthIndex, 1)
  const monthEnd = new Date(year, monthIndex + 1, 0)
  const visibleStart = new Date(Math.max(monthStart.getTime(), rangeStart.getTime()))
  const visibleEnd = new Date(Math.min(monthEnd.getTime(), rangeEnd.getTime()))
  if (visibleStart > visibleEnd) return []

  const mondayIndex = (d) => (d.getDay() + 6) % 7 // 0..6 Mon..Sun
  const isWeekend = (d) => {
    const day = d.getDay()
    return day === 0 || day === 6
  }

  const cells = []

  if (!weekdaysOnly) {
    const firstWeekday = mondayIndex(visibleStart)
    const lastWeekday = mondayIndex(visibleEnd)
    for (let i = 0; i < firstWeekday; i += 1) cells.push(null)
    const cursor = new Date(visibleStart)
    while (cursor <= visibleEnd) {
      cells.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    for (let i = lastWeekday; i < 6; i += 1) cells.push(null)
    return cells
  }

  // Weekdays-only grid (Mon-Fri). Skip Sat/Sun entirely.
  const firstIdx = mondayIndex(visibleStart) // 0..6
  const leading = firstIdx <= 4 ? firstIdx : 5 // if Sat/Sun, start next Monday row with 5 empties
  for (let i = 0; i < leading; i += 1) cells.push(null)

  const cursor = new Date(visibleStart)
  while (cursor <= visibleEnd) {
    if (!isWeekend(cursor)) cells.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }

  const lastNonNullIdx = (() => {
    for (let i = cells.length - 1; i >= 0; i -= 1) {
      if (cells[i]) return i
    }
    return -1
  })()

  if (lastNonNullIdx >= 0) {
    const lastDate = cells[lastNonNullIdx]
    const lastIdx = mondayIndex(lastDate) // 0..4 for Mon..Fri
    for (let i = lastIdx; i < 4; i += 1) cells.push(null)
  }

  return cells
}

function loadSetting(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw == null) return fallback
    try {
      return JSON.parse(raw)
    } catch (e) {
      return raw // legacy plain-string values (e.g. group stored as A/B)
    }
  } catch (e) {
    return fallback
  }
}

function saveSetting(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    // storage unavailable (e.g. private mode) — setting just won't persist
  }
}

/** useState persisted to localStorage (first-party, on-device only). */
function usePersistentState(key, initialValue, isValid) {
  const [value, setValue] = useState(() => {
    const loaded = loadSetting(key, undefined)
    if (loaded !== undefined && (!isValid || isValid(loaded))) return loaded
    return initialValue
  })
  useEffect(() => {
    saveSetting(key, value)
  }, [key, value])
  return [value, setValue]
}

const isBoolean = (v) => typeof v === 'boolean'
const isDayIndexList = (v) =>
  Array.isArray(v) && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
const isReminderList = (v) =>
  Array.isArray(v) && v.every((r) => r === 120 || r === 60 || r === 10)

function App() {
  const [group, setGroup] = usePersistentState(
    'fils-schedule-group',
    'B',
    (v) => v === 'A' || v === 'B'
  )
  const [selectedWeek, setSelectedWeek] = useState(() => getSemesterWeekNumber())
  const [showWeekend, setShowWeekend] = usePersistentState('fils-schedule-show-weekend', false, isBoolean)
  const [selectedDeadline, setSelectedDeadline] = useState(null)
  const [examsOpen, setExamsOpen] = useState(false)
  const [deadlineWarning, setDeadlineWarning] = useState(null)
  const deadlineWarningRef = useRef(null)
  const [coursesOpen, setCoursesOpen] = useState(false)
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [selectedCourse, setSelectedCourse] = useState(null)
  const [highlightGroupSelect, setHighlightGroupSelect] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [headerHidden, setHeaderHidden] = useState(false)
  const [exportWholeWeek, setExportWholeWeek] = usePersistentState('fils-schedule-export-whole-week', true, isBoolean)
  const [exportDayIndexes, setExportDayIndexes] = usePersistentState('fils-schedule-export-days', [0, 1, 2, 3, 4], isDayIndexList)
  const [exportReminders, setExportReminders] = usePersistentState('fils-schedule-export-reminders', [60, 10], isReminderList)
  const [includeOptionalExport, setIncludeOptionalExport] = usePersistentState('fils-schedule-export-optional', true, isBoolean)
  const settingsTouchStartRef = useRef(null)
  const currentWeek = getSemesterWeekNumber()
  const weekRange = getWeekDateRange(selectedWeek)
  const isCurrentWeek = selectedWeek === currentWeek
  const homeworks = useMemo(() => (scheduleData.homeworks || []).slice(), [])
  const tests = useMemo(() => (scheduleData.tests || []).slice(), [])
  const exams = useMemo(() => (scheduleData.exams || []).slice(), [])

  const hasRecentChangelog = useMemo(() => {
    const entries = changelogData.entries || []
    if (!entries.length) return false
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const oldest = new Date(today)
    oldest.setDate(oldest.getDate() - 6)
    return entries.some((e) => {
      if (!e?.date) return false
      const d = parseDateTime(e.date, '00:00')
      d.setHours(0, 0, 0, 0)
      return d >= oldest && d <= today
    })
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => setHighlightGroupSelect(false), 10_000)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const examsAutoOpenFrom = parseDateTime('2027-01-22')
    examsAutoOpenFrom.setHours(0, 0, 0, 0)
    if (today >= examsAutoOpenFrom) setExamsOpen(true)
  }, [])

  useEffect(() => {
    let lastY = window.scrollY || 0
    let ticking = false
    const MIN_DELTA = 8

    const update = () => {
      const y = window.scrollY || 0
      const delta = y - lastY

      if (Math.abs(delta) >= MIN_DELTA) {
        if (delta > 0 && y > 64) setHeaderHidden(true)
        else if (delta < 0) setHeaderHidden(false)
        lastY = y
      }
      ticking = false
    }

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(update)
        ticking = true
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const courses = useMemo(() => {
    const titles = scheduleData.classTitles || {}
    const links = scheduleData.courseLinks || {}
    const groups = scheduleData.groups || {}
    const allClasses = [...(groups.A || []), ...(groups.B || [])]

    const findTeamsLink = (name) => {
      const entry = allClasses.find((c) => c.name === name && c.teamsLink)
      return entry?.teamsLink || ''
    }

    return Object.keys(titles)
      .filter((name) => !String(name).includes('Lab'))
      .map((name) => ({
        name,
        full: titles[name]?.full || name,
        short: titles[name]?.short || '',
        teamsLink: findTeamsLink(name),
        moodleLink: links[name]?.moodle || '',
        notes: scheduleData.courseNotes?.[name] || '',
      }))
      .sort((a, b) => (a.short || a.full).localeCompare(b.short || b.full))
  }, [])

  const deadlines = useMemo(() => {
    const testDeadlines = tests
      .map((t) => {
        const cls =
          t.group === 'both'
            ? (scheduleData.groups?.A || []).find((c) => c.name === t.className)
              || (scheduleData.groups?.B || []).find((c) => c.name === t.className)
            : (scheduleData.groups?.[t.group] || []).find((c) => c.name === t.className)
        const day = cls?.day
        if (day == null) return null
        const dateKey = toDateKey(getDateForWeekDay(teachingWeekToContinuousWeek(Number(t.week)), Number(day) - 1))

        return {
          id: t.id,
          kind: 'test',
          subject:
            t.group === 'both'
              ? `${t.className} (Groups A & B)`
              : `${t.className} (Group ${t.group})`,
          title: t.title,
          deadline: dateKey,
          notes: t.notes || '',
          className: t.className,
          group: t.group,
          week: t.week,
        }
      })
      .filter(Boolean)

    const homeworkDeadlines = homeworks.map((hw) => ({
      ...hw,
      kind: 'homework',
    }))

    const examDeadlines = exams.map((exam) => {
      const shortName =
        scheduleData.classTitles?.[exam.subject]?.short
        || exam.subject
        || exam.className
        || 'Exam'
      const startTime = getExamTimeLabel(exam)
      // Keep the title tokens together when possible (avoid "Exam" wrapping above the course code).
      const title = startTime ? `Exam\u00a0${shortName}\u00a0${startTime}` : `Exam\u00a0${shortName}`
      const popupTitle = shortName
      return {
        id: exam.id,
        kind: 'exam',
        subject:
          exam.subject
          || exam.className
          || (exam.group && exam.group !== 'both' ? `Exam (Group ${exam.group})` : 'Exam'),
        title,
        popupTitle,
        deadline: exam.deadline,
        notes: exam.notes || '',
        group: exam.group || 'both',
        location: exam.location || '',
        startTime,
        endTime: exam.end || '',
        tentative: exam.tentative === true,
      }
    })

    return [...homeworkDeadlines, ...testDeadlines, ...examDeadlines].sort((a, b) => b.deadline.localeCompare(a.deadline))
  }, [homeworks, tests, exams])

  const groupVisibleDeadlines = useMemo(
    () => deadlines.filter((d) => isGroupMatch(d.group, group)),
    [deadlines, group]
  )

  const examDeadlines = useMemo(
    () => groupVisibleDeadlines.filter((d) => d.kind === 'exam'),
    [groupVisibleDeadlines]
  )

  const hasTentativeExams = useMemo(
    () => examDeadlines.some((exam) => exam.tentative === true),
    [examDeadlines]
  )

  const examsByDate = useMemo(() => {
    const map = {}
    examDeadlines.forEach((exam) => {
      if (!map[exam.deadline]) map[exam.deadline] = []
      map[exam.deadline].push(exam)
    })
    return map
  }, [examDeadlines])

  const hideExamPopupWeekends = useMemo(() => {
    const rangeStart = parseDateTime(EXAM_PERIOD_START)
    const rangeEnd = parseDateTime(EXAM_PERIOD_END)
    rangeStart.setHours(0, 0, 0, 0)
    rangeEnd.setHours(0, 0, 0, 0)

    return !examDeadlines.some((exam) => {
      const d = parseDateTime(exam.deadline)
      d.setHours(0, 0, 0, 0)
      if (d < rangeStart || d > rangeEnd) return false
      const day = d.getDay()
      return day === 0 || day === 6
    })
  }, [examDeadlines])

  const examWeekdayLabels = useMemo(
    () => (hideExamPopupWeekends ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']),
    [hideExamPopupWeekends]
  )

  const examWeekColumnCount = hideExamPopupWeekends ? 5 : 7

  const examMonths = useMemo(() => {
    const start = parseDateTime(EXAM_PERIOD_START)
    const end = parseDateTime(EXAM_PERIOD_END)
    const result = []
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
    while (cursor <= end) {
      result.push({
        key: `${cursor.getFullYear()}-${cursor.getMonth() + 1}`,
        year: cursor.getFullYear(),
        monthIndex: cursor.getMonth(),
        monthLabel: cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
        cells: buildExamMonthGridForRange(cursor.getFullYear(), cursor.getMonth(), start, end, hideExamPopupWeekends),
      })
      cursor.setMonth(cursor.getMonth() + 1)
    }
    return result
  }, [hideExamPopupWeekends])

  const examMonthsWithEntries = useMemo(() => {
    return examMonths.filter((month) =>
      examDeadlines.some((exam) => {
        const d = parseDateTime(exam.deadline)
        return d.getFullYear() === month.year && d.getMonth() === month.monthIndex
      })
    )
  }, [examMonths, examDeadlines])

  const { upcomingDeadlines, pastDeadlines } = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const upcoming = []
    const past = []

    groupVisibleDeadlines.forEach((item) => {
      const d = new Date(item.deadline + 'T00:00:00')
      if (d < today) past.push(item)
      else upcoming.push(item)
    })

    upcoming.sort((a, b) => a.deadline.localeCompare(b.deadline))
    past.sort((a, b) => b.deadline.localeCompare(a.deadline))

    return { upcomingDeadlines: upcoming, pastDeadlines: past }
  }, [groupVisibleDeadlines])

  const goPrev = () => setSelectedWeek((w) => Math.max(1, w - 1))
  const goNext = () => setSelectedWeek((w) => Math.min(SEMESTER_WEEKS, w + 1))
  const goToCurrent = () => setSelectedWeek(currentWeek)
  const addDeadlineToCalendar = (item) => {
    const startDate = parseDateTime(item.deadline, '09:00')
    const endDate = parseDateTime(item.deadline, '10:00')
    const eventTitle = item.kind === 'exam'
      ? item.title
      : `${item.subject ? `${item.subject}: ` : ''}${item.title}`
    downloadCalendarEvent({
      title: eventTitle,
      description: item.notes || '',
      startDate,
      endDate,
      allDay: true,
      filename: `${item.id || 'deadline'}.ics`,
    })
  }

  const selectedWeekClassEvents = useMemo(() => {
    if (isHolidayWeek(selectedWeek)) return []
    const teachingWeek = continuousWeekToTeachingWeek(selectedWeek)
    const classes = scheduleData.groups[group] || []
    const attendanceByWeek = scheduleData.attendanceByWeek || {}
    const freeDaysSet = new Set(scheduleData.freeDays || [])
    return classes
      .filter((cls) => {
        const weekEntry = getWeekEntry(attendanceByWeek, cls.name, teachingWeek)
        if (weekEntry && typeof weekEntry === 'object' && weekEntry.hidden === true) return false
        if (!includeOptionalExport && cls.optional) return false
        if (cls.onDemand) return shouldShowOnDemandClass(cls, teachingWeek, group, attendanceByWeek)
        if (cls.biWeeklyFromWeek != null) return shouldShowBiWeeklyClass(cls, teachingWeek)
        return true
      })
      .map((cls) => {
        const weekEntry = getWeekEntry(attendanceByWeek, cls.name, teachingWeek)
        const resolved = resolveWeekTimeFields(weekEntry, cls, group)
        const effectiveDay = resolved.day
        const effectiveStart = resolved.start
        const effectiveEnd = resolved.end
        const effectiveType =
          weekEntry && typeof weekEntry === 'object' && weekEntry.type ? weekEntry.type : (cls.location === 'online' ? 'online' : 'in-person')
        const effectiveLocation =
          weekEntry && typeof weekEntry === 'object' && weekEntry.location ? weekEntry.location : cls.location
        const date = getDateForWeekDay(selectedWeek, effectiveDay - 1)
        const [startH, startM] = effectiveStart.split(':').map(Number)
        const [endH, endM] = effectiveEnd.split(':').map(Number)
        const startDate = new Date(date)
        startDate.setHours(startH, startM, 0, 0)
        const endDate = new Date(date)
        endDate.setHours(endH, endM, 0, 0)
        const dateKey = toDateKey(date)
        if (freeDaysSet.has(dateKey) || isHolidayDate(date)) return null
        const baseDisplayName = scheduleData.classTitles?.[cls.name]?.full || cls.name
        const displayName = cls.optional ? `[Optional] ${baseDisplayName}` : baseDisplayName
        let description = `${displayName} - Week ${teachingWeek}`
        const timeslotNote = getTimeslotNote(weekEntry)
        if (timeslotNote) {
          description = `${timeslotNote}\n\n${description}`
        }
        if (effectiveType === 'online') {
          if (cls.teamsLink) {
            description += `\nTeams link: ${cls.teamsLink}`
          } else if (cls.onlineNote) {
            description += `\n${cls.onlineNote.replace(/\n+/g, ' ')}.`
            description += '\nMeeting link is shared on WhatsApp.'
          } else {
            description += '\nOnline class.'
          }
        }
        return {
          title: `${displayName} (Group ${group})`,
          description,
          location: effectiveLocation || '',
          startDate,
          endDate,
          allDay: false,
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
  }, [group, selectedWeek, includeOptionalExport])

  const selectedWeekDeadlineEvents = useMemo(() => {
    return groupVisibleDeadlines
      .filter((d) => {
        const deadlineDate = new Date(`${d.deadline}T00:00:00`)
        const weekStart = getDateForWeekDay(selectedWeek, 0)
        const weekEnd = getDateForWeekDay(selectedWeek, 6)
        weekStart.setHours(0, 0, 0, 0)
        weekEnd.setHours(23, 59, 59, 999)
        return deadlineDate >= weekStart && deadlineDate <= weekEnd
      })
      .map((d) => {
        const startDate = new Date(`${d.deadline}T09:00:00`)
        const endDate = new Date(`${d.deadline}T10:00:00`)
        const eventTitle = d.kind === 'exam'
          ? d.title
          : `${d.subject ? `${d.subject}: ` : ''}${d.title}`
        return {
          title: eventTitle,
          description: d.notes || '',
          location: '',
          startDate,
          endDate,
          allDay: true,
        }
      })
  }, [groupVisibleDeadlines, selectedWeek])

  const selectedWeekFreeDayEvents = useMemo(() => {
    const freeDays = scheduleData.freeDays || []
    const weekStart = getDateForWeekDay(selectedWeek, 0)
    const weekEnd = getDateForWeekDay(selectedWeek, 6)
    weekStart.setHours(0, 0, 0, 0)
    weekEnd.setHours(23, 59, 59, 999)

    const dateKeys = new Set(freeDays)
    for (let i = 0; i < 7; i += 1) {
      const d = getDateForWeekDay(selectedWeek, i)
      if (isHolidayDate(d)) dateKeys.add(toDateKey(d))
    }

    return [...dateKeys]
      .filter((dateKey) => {
        const date = new Date(`${dateKey}T00:00:00`)
        return date >= weekStart && date <= weekEnd
      })
      .map((dateKey) => {
        const startDate = new Date(`${dateKey}T09:00:00`)
        const endDate = new Date(`${dateKey}T10:00:00`)
        const reminderAt = new Date(`${dateKey}T17:00:00`)
        reminderAt.setDate(reminderAt.getDate() - 1)
        return {
          kind: 'free-day',
          title: 'No university classes',
          description: 'Out of office',
          location: '',
          startDate,
          endDate,
          allDay: true,
          absoluteReminderDateTimes: [reminderAt],
        }
      })
  }, [selectedWeek])

  const addSelectedWeekToCalendar = () => {
    const selectedDays = exportWholeWeek ? null : new Set(exportDayIndexes)
    const classEvents = exportWholeWeek
      ? selectedWeekClassEvents
      : selectedWeekClassEvents.filter((ev) => selectedDays.has((ev.startDate.getDay() + 6) % 7))
    const deadlineEvents = exportWholeWeek
      ? selectedWeekDeadlineEvents
      : selectedWeekDeadlineEvents.filter((ev) => selectedDays.has((ev.startDate.getDay() + 6) % 7))
    const freeDayEvents = exportWholeWeek ? selectedWeekFreeDayEvents : []
    const reminderSet = new Set(exportReminders)
    const remindersMinutes = [120, 60, 10].filter((m) => reminderSet.has(m))
    const events = [...classEvents, ...deadlineEvents, ...freeDayEvents].map((event) =>
      event.kind === 'free-day'
        ? { ...event, remindersMinutes: [] }
        : { ...event, remindersMinutes }
    )
    downloadCalendarEvents(events, `week-${selectedWeek}-schedule.ics`)
    setSettingsOpen(false)
  }

  const addUpcomingDeadlinesToCalendar = () => {
    const events = upcomingDeadlines.map((d) => {
      const startDate = new Date(`${d.deadline}T09:00:00`)
      const endDate = new Date(`${d.deadline}T10:00:00`)
      const eventTitle = d.kind === 'exam'
        ? d.title
        : `${d.subject ? `${d.subject}: ` : ''}${d.title}`
      return {
        title: eventTitle,
        description: d.notes || '',
        location: '',
        startDate,
        endDate,
        allDay: true,
      }
    })
    downloadCalendarEvents(events, 'upcoming-deadlines.ics')
  }
  const isPastDeadline = (item) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const d = new Date(item.deadline + 'T00:00:00')
    return d < today
  }

  const positionDeadlineWarningPopover = () => {
    const anchor = deadlineWarning?.anchorEl
    const popEl = deadlineWarningRef.current
    if (!anchor || !popEl) return

    const rect = anchor.getBoundingClientRect()
    const margin = 8
    const vw = window.innerWidth
    const vh = window.innerHeight

    const width = Math.min(320, vw - margin * 2)
    popEl.style.width = `${width}px`

    const popRect = popEl.getBoundingClientRect()
    let left = rect.right - popRect.width
    left = Math.min(Math.max(left, margin), vw - margin - popRect.width)

    let top = rect.bottom + 6
    if (top + popRect.height > vh - margin) {
      top = rect.top - 6 - popRect.height
    }
    top = Math.min(Math.max(top, margin), vh - margin - popRect.height)

    popEl.style.left = `${left}px`
    popEl.style.top = `${top}px`
  }

  useLayoutEffect(() => {
    if (!deadlineWarning) return undefined
    positionDeadlineWarningPopover()
    return undefined
  }, [deadlineWarning?.token])

  useEffect(() => {
    if (!deadlineWarning) return undefined

    const dismiss = () => setDeadlineWarning(null)
    const onScroll = () => dismiss()
    const onResize = () => positionDeadlineWarningPopover()

    const onPointerDown = (e) => {
      const target = e.target
      if (!(target instanceof Element)) return
      if (target.closest('.deadline-warning-popover')) return
      if (target.closest('.warning-badge-btn')) return
      dismiss()
    }

    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    window.addEventListener('resize', onResize)
    // Defer attaching outside-click so the opening click doesn't immediately dismiss.
    const t = window.setTimeout(() => document.addEventListener('pointerdown', onPointerDown, true), 0)

    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onResize)
      window.clearTimeout(t)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [deadlineWarning?.token])

  return (
    <div className="app">
      <header className={`app-header${headerHidden ? ' app-header--hidden' : ''}`}>
        <h1 className="app-title">
          <span className="app-title-top">FILS</span>
          <span className="app-title-bottom">Schedule</span>
        </h1>
        <div className="header-controls">
          <button
            type="button"
            className="exams-btn"
            onClick={() => setExamsOpen(true)}
            aria-label="Open exams calendar"
          >
            Exams
          </button>
          <button
            type="button"
            className="courses-btn"
            onClick={() => setCoursesOpen(true)}
            aria-label="Open courses list"
          >
            Courses List
          </button>
          <button
            type="button"
            className="changelog-btn"
            onClick={() => setChangelogOpen(true)}
            aria-label="Open changelog"
          >
            Changelog
          </button>
        </div>
      </header>
      <main className="app-main">
        {hasRecentChangelog && (
          <button
            type="button"
            className="changelog-nudge"
            onClick={() => setChangelogOpen(true)}
            aria-label="Open changelog: updates in the last 7 days"
          >
            Updates in the last 7 days — open changelog
          </button>
        )}
        <div className="calendar-legend">
          <span className="legend-item legend-online">
            <span className="legend-swatch" />
            Online attendance
          </span>
          <span className="legend-item legend-in-person">
            <span className="legend-swatch" />
            Physical attendance
          </span>
          <span className="legend-item legend-notes">
            <span className="legend-swatch" />
            Has notes (click on card)
          </span>
          <span className="legend-item legend-test">
            <span className="legend-swatch" />
            Test scheduled
          </span>
          <span className="legend-item legend-exam">
            <span className="legend-swatch" />
            Exam
          </span>
          <span className="legend-item legend-homework">
            <span className="legend-swatch" />
            Homework / deadline
          </span>
          <span className="legend-item legend-optional">
            <span className="legend-swatch" />
            Optional (check notes)
          </span>
          <span className="legend-item legend-free-day">
            <span className="legend-swatch" />
            Free day (no classes)
          </span>
        </div>
        <div className="calendar-shell">
          <div className="calendar-toolbar">
            <div className="week-nav">
              <button
                type="button"
                onClick={goPrev}
                disabled={selectedWeek <= 1}
                aria-label="Previous week"
              >
                ‹
              </button>
              <span className="week-label" title={weekRange.label}>
                <span className="week-label-line week-label-week">{getWeekTitle(selectedWeek)}</span>
                <span className="week-label-line week-label-month">
                  <span className="week-label-month-long">
                    {weekRange.monday.toLocaleDateString('en-GB', { month: 'long' })}
                  </span>
                  <span className="week-label-month-short" aria-hidden>
                    {weekRange.monday.toLocaleDateString('en-GB', { month: 'short' })}
                  </span>
                  <span className="week-label-month-num"> ({weekRange.monday.getMonth() + 1})</span>
                </span>
              </span>
              <button
                type="button"
                onClick={goNext}
                disabled={selectedWeek >= SEMESTER_WEEKS}
                aria-label="Next week"
              >
                ›
              </button>
            </div>
            <div className="calendar-toolbar-right">
              <button
                type="button"
                className="settings-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  setSettingsOpen((v) => !v)
                }}
                aria-label="Open settings"
                title="Settings"
              >
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.49-.42h-3.84a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.13.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.82 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54c.04.24.25.42.49.42h3.84c.24 0 .45-.18.49-.42l.36-2.54c.58-.23 1.13-.54 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" />
                </svg>
              </button>
              <div className={`group-select${highlightGroupSelect ? ' group-select--attention' : ''}`}>
                <select
                  id="group"
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                  aria-label="Select group"
                >
                  <option value="A">Group A (1)</option>
                  <option value="B">Group B (2)</option>
                </select>
              </div>
            </div>
            {settingsOpen && (
              <>
                <div
                  className="settings-backdrop"
                  onClick={() => setSettingsOpen(false)}
                  onTouchStart={() => setSettingsOpen(false)}
                />
                <div
                  className="settings-popover"
                  onClick={(e) => e.stopPropagation()}
                  onTouchStart={(e) => {
                    e.stopPropagation()
                    if (e.touches.length !== 1) return
                    settingsTouchStartRef.current = {
                      x: e.touches[0].clientX,
                      y: e.touches[0].clientY,
                    }
                  }}
                  onTouchEnd={(e) => {
                    e.stopPropagation()
                    if (!settingsTouchStartRef.current || e.changedTouches.length !== 1) return
                    const start = settingsTouchStartRef.current
                    settingsTouchStartRef.current = null
                    const end = e.changedTouches[0]
                    const deltaX = end.clientX - start.x
                    const deltaY = end.clientY - start.y
                    if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY)) {
                      setSettingsOpen(false)
                    }
                  }}
                >
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      checked={showWeekend}
                      onChange={(e) => setShowWeekend(e.target.checked)}
                    />
                    Display weekends
                  </label>
                  <div className="settings-divider" />
                  <div className="settings-export-title">Export week to calendar</div>
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      checked={includeOptionalExport}
                      onChange={(e) => setIncludeOptionalExport(e.target.checked)}
                    />
                    Include optional classes
                  </label>
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      checked={exportWholeWeek}
                      onChange={(e) => setExportWholeWeek(e.target.checked)}
                    />
                    Whole week
                  </label>
                  <div className="settings-days-grid">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, idx) => (
                      <label key={day} className="settings-check settings-check-day">
                        <input
                          type="checkbox"
                          checked={exportWholeWeek ? true : exportDayIndexes.includes(idx)}
                          disabled={exportWholeWeek}
                          onChange={(e) => {
                            setExportDayIndexes((prev) =>
                              e.target.checked ? [...prev, idx].sort((a, b) => a - b) : prev.filter((d) => d !== idx)
                            )
                          }}
                        />
                        {day}
                      </label>
                    ))}
                  </div>
                  <div className="settings-reminders-title">Reminders</div>
                  <div className="settings-reminders-grid">
                    {[
                      { value: 120, label: '2 hours' },
                      { value: 60, label: '1 hour' },
                      { value: 10, label: '10 minutes' },
                    ].map((option) => (
                      <label key={option.value} className="settings-check settings-check-day">
                        <input
                          type="checkbox"
                          checked={exportReminders.includes(option.value)}
                          onChange={(e) => {
                            setExportReminders((prev) =>
                              e.target.checked
                                ? [...prev, option.value].sort((a, b) => b - a)
                                : prev.filter((v) => v !== option.value)
                            )
                          }}
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="bulk-calendar-btn settings-export-btn"
                    onClick={addSelectedWeekToCalendar}
                    disabled={!exportWholeWeek && exportDayIndexes.length === 0}
                  >
                    Export
                  </button>
                </div>
              </>
            )}
          </div>
          <Calendar
            classes={scheduleData.groups[group] || []}
            group={group}
            classTitles={scheduleData.classTitles || {}}
            courseNotes={scheduleData.courseNotes || {}}
            attendanceByWeek={scheduleData.attendanceByWeek || {}}
            weekNumber={selectedWeek}
            showWeekend={showWeekend}
            onPrevWeek={goPrev}
            onNextWeek={goNext}
            freeDays={scheduleData.freeDays || []}
            onGoToCurrentWeek={goToCurrent}
            homeworks={deadlines.filter((d) => d.kind === 'homework')}
            tests={tests}
            onSelectHomework={setSelectedDeadline}
          />
        </div>

        {groupVisibleDeadlines.length > 0 && (
          <div className="homework-section">
            {upcomingDeadlines.length > 0 && (
              <>
                <div className="homework-subsection-row">
                  <h3 className="homework-subsection-title">Upcoming deadlines</h3>
                  <button
                    type="button"
                    className="bulk-calendar-btn"
                    onClick={addUpcomingDeadlinesToCalendar}
                    title="Export upcoming deadlines to calendar"
                  >
                    Export upcoming deadlines
                  </button>
                </div>
                <div className="homework-list">
                  {upcomingDeadlines.map((item) => {
                    const deadlineDate = new Date(item.deadline + 'T00:00:00')
                    const isTest = item.kind === 'test'
                    const isExam = item.kind === 'exam'
                    const isTentativeExam = isExam && item.tentative === true
                    return (
                      <div key={item.id} className={`homework-card${isTest ? ' homework-card--test' : ''}${isExam ? ' homework-card--exam' : ''}${isTentativeExam ? ' homework-card--tentative' : ''}`}>
                        <button
                          type="button"
                          className="homework-card-main"
                          onClick={() => setSelectedDeadline(item)}
                        >
                          <span className="homework-card-subject">{item.subject}</span>
                          <span className="homework-card-title">{item.title}</span>
                          <span className="homework-card-deadline">
                            {deadlineDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                          </span>
                        </button>
                        <div className="homework-card-actions">
                          {isTentativeExam && (
                            <button
                              type="button"
                              className="warning-badge-btn"
                              aria-label="Show tentative date warning"
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                if (deadlineWarning?.id === item.id) {
                                  setDeadlineWarning(null)
                                  return
                                }
                                setDeadlineWarning({
                                  token: Date.now(),
                                  id: item.id,
                                  message: TENTATIVE_EXAM_TOOLTIP,
                                  anchorEl: e.currentTarget,
                                })
                              }}
                            >
                              !
                            </button>
                          )}
                          <button
                            type="button"
                            className="calendar-action-btn"
                            aria-label={`Add ${item.title} to calendar`}
                            title="Add to calendar"
                            onClick={() => addDeadlineToCalendar(item)}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden>
                              <path d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1a3 3 0 0 1 3 3v11a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V7a3 3 0 0 1 3-3h1V3a1 1 0 0 1 1-1zm13 9H4v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7zM5 6a1 1 0 0 0-1 1v2h16V7a1 1 0 0 0-1-1H5z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {pastDeadlines.length > 0 && (
              <>
                <h3 className="homework-subsection-title">Past deadlines</h3>
                <div className="homework-list">
                  {pastDeadlines.map((item) => {
                    const deadlineDate = new Date(item.deadline + 'T00:00:00')
                    const isTest = item.kind === 'test'
                    const isExam = item.kind === 'exam'
                    const isTentativeExam = isExam && item.tentative === true
                    return (
                      <div
                        key={item.id}
                        className={`homework-card homework-card--past${isTest ? ' homework-card--test' : ''}${isExam ? ' homework-card--exam' : ''}${isTentativeExam ? ' homework-card--tentative' : ''}`}
                      >
                        <button
                          type="button"
                          className="homework-card-main"
                          onClick={() => setSelectedDeadline(item)}
                        >
                          <span className="homework-card-subject">{item.subject}</span>
                          <span className="homework-card-title">{item.title}</span>
                          <span className="homework-card-deadline">
                            {deadlineDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                          </span>
                        </button>
                        {isTentativeExam && (
                          <button
                            type="button"
                            className="warning-badge-btn"
                            aria-label="Show tentative date warning"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              if (deadlineWarning?.id === item.id) {
                                setDeadlineWarning(null)
                                return
                              }
                              setDeadlineWarning({
                                token: Date.now(),
                                id: item.id,
                                message: TENTATIVE_EXAM_TOOLTIP,
                                anchorEl: e.currentTarget,
                              })
                            }}
                          >
                            !
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {examsOpen && (
        <div
          className="notes-modal-overlay"
          onClick={() => setExamsOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="exams-modal-title"
        >
          <div className="notes-modal exams-modal" onClick={(e) => e.stopPropagation()}>
            <div className="notes-modal-header">
              <h2 id="exams-modal-title" className="notes-modal-title">
                Exams Calendar (23 Jan - 12 Feb)
              </h2>
              <button
                type="button"
                className="notes-modal-close"
                onClick={() => setExamsOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="notes-modal-body exams-modal-body">
              <div className="exams-range-note">
                Interval: {new Date(`${EXAM_PERIOD_START}T00:00:00`).toLocaleDateString('en-GB')} - {new Date(`${EXAM_PERIOD_END}T00:00:00`).toLocaleDateString('en-GB')}
              </div>
              {hasTentativeExams && (
                <div className="exams-warning-banner">
                  Some exams do not have a fixed date yet. See entries with the warning icon.
                </div>
              )}
              <div className="exams-months">
                {examMonthsWithEntries.map((month) => (
                  <section key={month.key} className="exam-month">
                    <h3 className="exam-month-title">{month.monthLabel}</h3>
                    <div
                      className={`exam-month-grid${hideExamPopupWeekends ? ' exam-month-grid--weekdays' : ''}`}
                      style={{ '--exam-week-cols': examWeekColumnCount }}
                    >
                      {examWeekdayLabels.map((day) => (
                        <div key={day} className="exam-month-weekday">{day}</div>
                      ))}
                      {month.cells.map((date, cellIndex) => {
                        if (!date) {
                          return <div key={`${month.key}-empty-${cellIndex}`} className="exam-day exam-day--empty" aria-hidden />
                        }
                        const dateKey = toDateKey(date)
                        const events = examsByDate[dateKey] || []
                        return (
                          <div
                            key={`${month.key}-${dateKey}`}
                            className="exam-day"
                          >
                            <span className="exam-day-number">{date.getDate()}</span>
                            {events.length > 0 && (
                              <div className="exam-day-events">
                                {events.map((exam) => {
                                  const hasTime = Boolean(exam.startTime)
                                  const chipClass = [
                                    'exam-chip',
                                    exam.tentative === true ? 'exam-chip--tentative' : '',
                                    hasTime ? 'exam-chip--has-time' : '',
                                  ]
                                    .filter(Boolean)
                                    .join(' ')
                                  return (
                                    <div key={exam.id} className="exam-chip-wrap">
                                      <div
                                        role="button"
                                        tabIndex={0}
                                        className={chipClass}
                                        onClick={() => setSelectedDeadline(exam)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault()
                                            setSelectedDeadline(exam)
                                          }
                                        }}
                                        title={
                                          exam.tentative === true
                                            ? `${exam.title} — ${TENTATIVE_EXAM_TOOLTIP}`
                                            : exam.title
                                        }
                                      >
                                        <span className="exam-chip-title">{exam.popupTitle || exam.title}</span>
                                        {hasTime && <span className="exam-chip-time">{exam.startTime}</span>}
                                        {exam.tentative === true && (
                                          <span
                                            className="warning-badge-btn warning-badge-btn--chip"
                                            aria-hidden="true"
                                          >
                                            !
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </section>
                ))}
                {examMonthsWithEntries.length === 0 && (
                  <div className="exams-range-note">No exams scheduled in this interval yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedDeadline && (
        <div
          className="notes-modal-overlay"
          onClick={() => setSelectedDeadline(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="hw-modal-title"
        >
          <div className="notes-modal hw-modal" onClick={(e) => e.stopPropagation()}>
            <div className="notes-modal-header hw-modal-header">
              <div>
                <span className={`hw-modal-subject${selectedDeadline.kind === 'exam' ? ' hw-modal-subject--exam' : ''}`}>{selectedDeadline.subject}</span>
                <h2 id="hw-modal-title" className="notes-modal-title">{selectedDeadline.title}</h2>
                <span className="hw-modal-deadline">
                  {selectedDeadline.kind === 'exam' ? 'Exam date' : 'Deadline'}: {new Date(selectedDeadline.deadline + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
                {!isPastDeadline(selectedDeadline) && (
                  <button
                    type="button"
                    className="calendar-action-btn hw-modal-calendar-btn"
                    aria-label={`Add ${selectedDeadline.title} to calendar`}
                    onClick={() => addDeadlineToCalendar(selectedDeadline)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden>
                      <path d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1a3 3 0 0 1 3 3v11a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V7a3 3 0 0 1 3-3h1V3a1 1 0 0 1 1-1zm13 9H4v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7zM5 6a1 1 0 0 0-1 1v2h16V7a1 1 0 0 0-1-1H5z" />
                    </svg>
                    Add to calendar
                  </button>
                )}
              </div>
              <button
                type="button"
                className="notes-modal-close"
                onClick={() => setSelectedDeadline(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="notes-modal-body">
              <pre className="notes-modal-content">{renderNoteText(selectedDeadline.notes)}</pre>
            </div>
          </div>
        </div>
      )}

      {selectedCourse && (
        <div
          className="notes-modal-overlay is-top is-topmost"
          onClick={() => setSelectedCourse(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="course-modal-title"
        >
          <div className="notes-modal" onClick={(e) => e.stopPropagation()}>
            <div className="notes-modal-header">
              <h2 id="course-modal-title" className="notes-modal-title">
                {scheduleData.classTitles?.[selectedCourse]?.full || selectedCourse} — Notes
              </h2>
              <button
                type="button"
                className="notes-modal-close"
                onClick={() => setSelectedCourse(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="notes-modal-body">
              <pre className="notes-modal-content">{renderNoteText(scheduleData.courseNotes?.[selectedCourse] || '')}</pre>
            </div>
          </div>
        </div>
      )}

      {changelogOpen && (
        <div
          className="notes-modal-overlay is-top"
          onClick={() => setChangelogOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="changelog-modal-title"
        >
          <div className="notes-modal changelog-modal" onClick={(e) => e.stopPropagation()}>
            <div className="notes-modal-header">
              <h2 id="changelog-modal-title" className="notes-modal-title">Changelog</h2>
              <button
                type="button"
                className="notes-modal-close"
                onClick={() => setChangelogOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="notes-modal-body changelog-modal-body">
              <ul className="changelog-entries">
                {(changelogData.entries || [])
                  .slice()
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((entry) => (
                    <li key={entry.date} className="changelog-entry">
                      <time className="changelog-date" dateTime={entry.date}>
                        {new Date(`${entry.date}T12:00:00`).toLocaleDateString('en-GB', {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </time>
                      <ul className="changelog-items">
                        {(entry.items || []).map((text, i) => (
                          <li key={i}>{text}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {coursesOpen && (
        <div
          className="notes-modal-overlay"
          onClick={() => setCoursesOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="courses-modal-title"
        >
          <div className="notes-modal courses-modal" onClick={(e) => e.stopPropagation()}>
            <div className="notes-modal-header">
              <h2 id="courses-modal-title" className="notes-modal-title">Courses</h2>
              <button
                type="button"
                className="notes-modal-close"
                onClick={() => setCoursesOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="notes-modal-body courses-modal-body">
              <div className="courses-list">
                {courses.map((c) => {
                  const hasNotes = (c.notes || '').trim().length > 0
                  const hasTeams = (c.teamsLink || '').trim().length > 0
                  const hasMoodle = (c.moodleLink || '').trim().length > 0
                  return (
                    <div
                      key={c.name}
                      className={`course-row${hasNotes ? ' course-row--has-notes' : ''}`}
                      role={hasNotes ? 'button' : undefined}
                      tabIndex={hasNotes ? 0 : -1}
                      onClick={hasNotes ? () => { setSelectedCourse(c.name) } : undefined}
                      onKeyDown={hasNotes ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setSelectedCourse(c.name)
                        }
                      } : undefined}
                    >
                      <div className="course-row-main">
                        <div className="course-row-title">
                          <div className="course-row-short">{c.short || c.name}</div>
                          <div className="course-row-full">{c.full}</div>
                        </div>
                      </div>
                      <div className="course-row-actions" onClick={(e) => e.stopPropagation()}>
                        <a
                          className={`course-action-btn${!hasTeams ? ' is-disabled' : ''}`}
                          href={hasTeams ? c.teamsLink : undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-disabled={!hasTeams}
                          tabIndex={hasTeams ? 0 : -1}
                          onClick={(e) => { if (!hasTeams) e.preventDefault() }}
                        >
                          Teams
                        </a>
                        <a
                          className={`course-action-btn${!hasMoodle ? ' is-disabled' : ''}`}
                          href={hasMoodle ? c.moodleLink : undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-disabled={!hasMoodle}
                          tabIndex={hasMoodle ? 0 : -1}
                          onClick={(e) => { if (!hasMoodle) e.preventDefault() }}
                        >
                          Moodle
                        </a>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {deadlineWarning && (
        <div
          ref={deadlineWarningRef}
          className="deadline-warning-popover"
          role="status"
          aria-live="polite"
        >
          {deadlineWarning.message}
        </div>
      )}
    </div>
  )
}

export default App
