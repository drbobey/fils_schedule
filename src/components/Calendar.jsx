import React, { useMemo, useState, useEffect, useRef } from 'react'
import { getSemesterWeekNumber, getDateForWeekDay, resolveWeekTimeFields, getTimeslotNote, isHolidayWeek, isHolidayDate, continuousWeekToTeachingWeek } from '../utils/weekUtils'
import renderNoteText from '../utils/renderNoteText'
import { downloadCalendarEvent } from '../utils/calendarUtils'
import { layoutOverlappingEvents, getOverlapEventStyle } from '../utils/overlapLayout'
import './Calendar.css'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const FIRST_HOUR = 7
const LAST_HOUR = 21
const ROW_HEIGHT_PX = 48
const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i)

function parseTime(t) {
  const [h, m] = t.split(':').map(Number)
  return h + m / 60
}

const GRID_END_HOUR = LAST_HOUR + 1 // last row (21) spans 21:00–22:00

function getCurrentTimePosition() {
  const now = new Date()
  const day = now.getDay()
  const hourDecimal = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600
  const inRange = hourDecimal >= FIRST_HOUR && hourDecimal < GRID_END_HOUR
  const isWeekday = day >= 1 && day <= 6
  const gridHeightPx = (LAST_HOUR - FIRST_HOUR + 1) * ROW_HEIGHT_PX
  let topPx
  if (hourDecimal < FIRST_HOUR) {
    topPx = 0
  } else if (hourDecimal >= GRID_END_HOUR) {
    topPx = gridHeightPx
  } else {
    topPx = (hourDecimal - FIRST_HOUR) * ROW_HEIGHT_PX
  }
  return {
    dayIndex: day === 0 ? 6 : day - 1,
    topPx,
    isLive: isWeekday && inRange,
  }
}

function getClassDisplay(cls, classTitles) {
  const t = classTitles?.[cls.name]
  const baseTitle = t?.full || cls.name
  const title = cls.optional ? `[Optional] ${baseTitle}` : baseTitle
  if (t) return { title, short: t.short }
  return { title, short: null }
}

function typeFromLocation(location) {
  return location === 'online' ? 'online' : 'in-person'
}

function getWeekEntry(attendanceByWeek, className, weekNumber) {
  const entry = attendanceByWeek?.[className]?.[String(weekNumber)]
  return entry
}

function getEffectiveType(cls, weekNumber, attendanceByWeek) {
  const baseType = typeFromLocation(cls.location)
  const weekEntry = getWeekEntry(attendanceByWeek, cls.name, weekNumber)
  if (!weekEntry) return baseType
  const type = typeof weekEntry === 'object' ? weekEntry.type : weekEntry
  return type ?? baseType
}

function getEffectiveLocation(cls, weekNumber, attendanceByWeek) {
  const weekEntry = getWeekEntry(attendanceByWeek, cls.name, weekNumber)
  if (weekEntry && typeof weekEntry === 'object' && weekEntry.location) return weekEntry.location
  return cls.location
}

function shouldShowOnDemandClass(cls, weekNumber, group, attendanceByWeek) {
  const weekEntry = getWeekEntry(attendanceByWeek, cls.name, weekNumber)
  if (!weekEntry) return false
  // If group is specified, show only for that group; otherwise show for both
  if (typeof weekEntry === 'object' && weekEntry.group != null && weekEntry.group !== '') return weekEntry.group === group
  return true
}

function shouldShowBiWeeklyClass(cls, weekNumber) {
  const start = cls.biWeeklyFromWeek
  if (start == null) return true
  return weekNumber >= start && (weekNumber - start) % 2 === 0
}

const SWIPE_THRESHOLD_PX = 50

/** Wikimedia Commons: File:Microsoft Office Teams (2025–present).svg (same graphic as linked by user). */
function TeamsGlyph() {
  return (
    <img
      className="notes-modal-brand-icon notes-modal-brand-icon--teams-logo"
      src={`${import.meta.env.BASE_URL}microsoft-teams-2025.svg`}
      alt=""
      width={20}
      height={20}
      draggable={false}
    />
  )
}

function WhatsAppGlyph() {
  return (
    <svg className="notes-modal-brand-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path
        fill="currentColor"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"
      />
    </svg>
  )
}

function toDateKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function Calendar({ classes, group, classTitles, courseNotes = {}, attendanceByWeek, weekNumber: weekNumberProp, showWeekend = true, onPrevWeek, onNextWeek, freeDays = [], onGoToCurrentWeek, homeworks = [], tests = [], onSelectHomework }) {
  const [notesModal, setNotesModal] = useState(null)
  const [currentTime, setCurrentTime] = useState(() => getCurrentTimePosition())
  const touchStart = useRef(null)
  const freeDaysSet = useMemo(() => new Set(freeDays), [freeDays])

  const testsKeyed = useMemo(() => {
    const map = new Map()
    tests.forEach((t) => {
      const groups = t.group === 'both' ? ['A', 'B'] : [t.group]
      groups.forEach((g) => {
        map.set(`${g}|${t.week}|${t.className}`, t)
      })
    })
    return map
  }, [tests])
  const optionalClassNames = useMemo(() => {
    const set = new Set()
    classes.forEach((cls) => {
      if (cls.optional) set.add(cls.name)
    })
    return set
  }, [classes])

  const homeworksByDate = useMemo(() => {
    const map = {}
    homeworks.forEach((hw) => {
      if (!map[hw.deadline]) map[hw.deadline] = []
      map[hw.deadline].push(hw)
    })
    return map
  }, [homeworks])
  useEffect(() => {
    const tick = () => setCurrentTime(getCurrentTimePosition())
    tick() // align immediately in case initial state was stale
    const id = setInterval(tick, 60_000) // update every 60 seconds
    return () => clearInterval(id)
  }, [])
  const currentWeek = useMemo(getSemesterWeekNumber, [])
  const weekNumber = weekNumberProp ?? currentWeek
  const teachingWeek = continuousWeekToTeachingWeek(weekNumber)
  const notesModalMeetingLinks = useMemo(() => {
    if (!notesModal?.cls) {
      return { showTeams: false, teamsHref: '', showWhatsapp: false, whatsappHref: '' }
    }
    const cls = notesModal.cls
    const eff = getEffectiveType(cls, teachingWeek, attendanceByWeek)
    if (eff !== 'online') {
      return { showTeams: false, teamsHref: '', showWhatsapp: false, whatsappHref: '' }
    }
    const teamsHref = (cls.teamsLink || '').trim()
    const showTeams = teamsHref.length > 0
    const showWhatsapp = Boolean((cls.onlineNote || '').trim())
    const whatsappHref = cls.onlineNoteHref || 'https://web.whatsapp.com/'
    return { showTeams, teamsHref, showWhatsapp, whatsappHref }
  }, [notesModal, weekNumber, attendanceByWeek])
  const notesModalSchedule = useMemo(() => {
    if (!notesModal?.cls) return null
    const cls = notesModal.cls
    const weekEntry = getWeekEntry(attendanceByWeek, cls.name, teachingWeek)
    const resolved = resolveWeekTimeFields(weekEntry, cls, group)
    const time = `${resolved.start}–${resolved.end}`
    let room = null
    if (getEffectiveType(cls, teachingWeek, attendanceByWeek) === 'in-person') {
      const location = getEffectiveLocation(cls, teachingWeek, attendanceByWeek)
      if (location && location !== 'online') room = location
    }
    return { time, room }
  }, [notesModal, weekNumber, group, attendanceByWeek])
  const isCurrentWeek = weekNumberProp == null || weekNumber === currentWeek
  const visibleDays = showWeekend ? DAYS : DAYS.slice(0, 5)
  const dayCount = visibleDays.length
  const currentDayIndex = useMemo(() => {
    const d = new Date().getDay()
    return d === 0 ? 6 : d - 1
  }, [])
  const showCurrentDay = isCurrentWeek && currentDayIndex < dayCount

  const todayLabel = useMemo(() => {
    const d = new Date()
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
  }, [])

  const isAheadOfCurrentWeek = weekNumber > currentWeek
  const isBeforeCurrentWeek = weekNumber < currentWeek

  const eventsByDay = useMemo(() => {
    const grid = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] }
    if (isHolidayWeek(weekNumber)) return grid
    classes.forEach((c) => {
      const weekEntry = getWeekEntry(attendanceByWeek, c.name, teachingWeek)
      if (weekEntry && typeof weekEntry === 'object' && weekEntry.hidden === true) return
      if (c.onDemand) {
        if (!shouldShowOnDemandClass(c, teachingWeek, group, attendanceByWeek)) return
      }
      if (c.biWeeklyFromWeek != null && !shouldShowBiWeeklyClass(c, teachingWeek)) return
      const resolved = resolveWeekTimeFields(weekEntry, c, group)
      const effectiveDay = resolved.day
      if (!grid[effectiveDay]) return
      grid[effectiveDay].push({
        id: c.name,
        cls: c,
        start: parseTime(resolved.start),
        end: parseTime(resolved.end),
        startStr: resolved.start,
        endStr: resolved.end,
        day: effectiveDay,
      })
    })
    Object.keys(grid).forEach((d) => {
      grid[Number(d)] = layoutOverlappingEvents(grid[Number(d)])
    })
    return grid
  }, [classes, weekNumber, group, attendanceByWeek])

  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    }
  }

  const handleTouchEnd = (e) => {
    if (!touchStart.current || e.changedTouches.length !== 1) return
    const end = e.changedTouches[0]
    const deltaX = end.clientX - touchStart.current.x
    const deltaY = end.clientY - touchStart.current.y
    touchStart.current = null
    if (Math.abs(deltaX) <= Math.abs(deltaY) || Math.abs(deltaX) < SWIPE_THRESHOLD_PX) return
    if (deltaX > 0 && typeof onPrevWeek === 'function') onPrevWeek()
    else if (deltaX < 0 && typeof onNextWeek === 'function') onNextWeek()
  }
  const addHomeworkToCalendar = (hw, dateKey) => {
    const startDate = new Date(`${dateKey}T09:00:00`)
    const endDate = new Date(`${dateKey}T10:00:00`)
    downloadCalendarEvent({
      title: `${hw.subject ? `${hw.subject}: ` : ''}${hw.title}`,
      description: hw.notes || '',
      startDate,
      endDate,
      allDay: true,
      filename: `${hw.id || 'deadline'}.ics`,
    })
  }

  const addClassToCalendar = ({ cls, test }) => {
    if (!cls) return

    const weekEntry = getWeekEntry(attendanceByWeek, cls.name, teachingWeek)
    const resolved = resolveWeekTimeFields(weekEntry, cls, group)
    const effectiveDay = resolved.day
    const effectiveStartStr = resolved.start
    const effectiveEndStr = resolved.end
    const effectiveType = getEffectiveType(cls, teachingWeek, attendanceByWeek)
    const effectiveLocation = getEffectiveLocation(cls, teachingWeek, attendanceByWeek)
    const display = getClassDisplay(cls, classTitles)
    const date = getDateForWeekDay(weekNumber, effectiveDay - 1)
    const [startH, startM] = effectiveStartStr.split(':').map(Number)
    const [endH, endM] = effectiveEndStr.split(':').map(Number)
    const startDate = new Date(date)
    startDate.setHours(startH, startM, 0, 0)
    const endDate = new Date(date)
    endDate.setHours(endH, endM, 0, 0)

    let description = courseNotes[cls.name] || ''
    const timeslotNote = getTimeslotNote(weekEntry)
    if (test?.notes) {
      description = description ? `${test.notes}\n\n${description}` : test.notes
    }
    if (timeslotNote) {
      description = description ? `${timeslotNote}\n\n${description}` : timeslotNote
    }
    if (effectiveType === 'online') {
      if (cls.teamsLink) {
        description = description ? `${description}\n\nTeams link: ${cls.teamsLink}` : `Teams link: ${cls.teamsLink}`
      } else if (cls.onlineNote) {
        description = description
          ? `${description}\n\n${cls.onlineNote}`
          : cls.onlineNote
      }
    }

    downloadCalendarEvent({
      title: test?.title || display.title,
      description,
      location: effectiveType === 'online' ? '' : effectiveLocation || '',
      startDate,
      endDate,
      allDay: false,
      filename: `${test?.id || cls.name || 'class'}-${weekNumber}.ics`,
    })
  }

  const isClassEventInPast = ({ cls }) => {
    if (!cls) return true

    const weekEntry = getWeekEntry(attendanceByWeek, cls.name, teachingWeek)
    const resolved = resolveWeekTimeFields(weekEntry, cls, group)
    const effectiveDay = resolved.day
    const effectiveEndStr = resolved.end
    const date = getDateForWeekDay(weekNumber, effectiveDay - 1)
    const [endH, endM] = effectiveEndStr.split(':').map(Number)
    const endDate = new Date(date)
    endDate.setHours(endH, endM, 0, 0)

    return endDate.getTime() < Date.now()
  }

  return (
    <div
      className="calendar"
      style={{ '--row-height': `${ROW_HEIGHT_PX}px`, '--day-columns': dayCount }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="calendar-grid">
        <button
          type="button"
          className={`calendar-corner${!isCurrentWeek ? ' calendar-corner--go-today' : ''}`}
          onClick={typeof onGoToCurrentWeek === 'function' ? onGoToCurrentWeek : undefined}
          aria-label="Go to current week"
          title={isCurrentWeek ? undefined : 'Go to current week'}
        >
          {!isCurrentWeek && (
            <>
              <span className="calendar-corner-arrow" aria-hidden>
                {isAheadOfCurrentWeek ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 12H5M12 19l-7-7 7-7" />
                  </svg>
                ) : isBeforeCurrentWeek ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                ) : null}
              </span>
              <span className="calendar-corner-date">{todayLabel}</span>
            </>
          )}
        </button>
        {visibleDays.map((name, dayIndex) => {
          const date = getDateForWeekDay(weekNumber, dayIndex)
          const dayNumber = date.getDate()
          const isFreeDay = freeDaysSet.has(toDateKey(date)) || isHolidayDate(date)
          return (
            <div
              key={name}
              className={`calendar-day-header${showCurrentDay && dayIndex === currentDayIndex ? ' current-day' : ''}${isFreeDay ? ' free-day' : ''}`}
            >
              <span className="day-header-name">
                <span className="day-header-name-long">{name}</span>
                <span className="day-header-name-short" aria-hidden>
                  {name.charAt(0)}
                </span>
              </span>
              <span className="day-header-date">{dayNumber}</span>
            </div>
          )
        })}
        {HOURS.map((hour) => (
          <React.Fragment key={hour}>
            <div className="calendar-time-label">
              {hour.toString().padStart(2, '0')}:00
            </div>
            {visibleDays.map((_, dayIndex) => {
              const date = getDateForWeekDay(weekNumber, dayIndex)
              const dateKey = toDateKey(date)
              const isFreeDay = freeDaysSet.has(dateKey) || isHolidayDate(date)
              const cellHomeworks = hour === FIRST_HOUR ? (homeworksByDate[dateKey] || []) : []
              return (
              <div
                key={`${hour}-${dayIndex}`}
                className={`calendar-cell${showCurrentDay && dayIndex === currentDayIndex ? ' current-day' : ''}${isFreeDay ? ' free-day' : ''}`}
                data-hour={hour}
                data-day={dayIndex}
              >
                {cellHomeworks.length > 0 && (
                  <div className="calendar-hw-group">
                    {cellHomeworks.map((hw) => (
                      <div key={hw.id} className="calendar-hw-item">
                        <button
                          type="button"
                          className="calendar-hw-main"
                          title={`${hw.subject}: ${hw.title}`}
                          onClick={() => typeof onSelectHomework === 'function' && onSelectHomework(hw)}
                          aria-label={`Homework: ${hw.title}`}
                        >
                          <span className="calendar-hw-circle">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-2 14l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" />
                            </svg>
                          </span>
                          <span className="calendar-hw-label">{hw.subject}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {eventsByDay[dayIndex + 1]
                  ?.filter((event) => Math.floor(event.start) === hour)
                  .map((event) => {
                  const { cls, start, end, startStr, endStr, day: effectiveDay, columnCount } = event
                  const durationHours = end - start
                  const topPercent = (start - hour) * 100
                  const heightPx = durationHours * ROW_HEIGHT_PX
                  const display = getClassDisplay(cls, classTitles)
                  const isCompactCard = durationHours <= 1
                  const effectiveType = getEffectiveType(cls, teachingWeek, attendanceByWeek)
                  const effectiveRoom = effectiveType === 'online' ? 'online' : getEffectiveLocation(cls, teachingWeek, attendanceByWeek)
                  const weekEntry = getWeekEntry(attendanceByWeek, cls.name, teachingWeek)
                  const timeslotNote = getTimeslotNote(weekEntry)
                  const hasCourseNotes = !!courseNotes[cls.name]
                  const hasTimeslotNote = !!timeslotNote
                  const testKey = `${group}|${teachingWeek}|${cls.name}`
                  const test = testsKeyed.get(testKey) || null
                  const hasTest = !!test
                  const primaryLabel = hasTest ? test.title : display.title
                  const compactLabel = hasTest ? test.title : display.short || cls.name
                  return (
                    <div
                      key={`${cls.name}-${startStr}-${endStr}-${effectiveDay}`}
                      className={`calendar-event ${effectiveType}${isCompactCard ? ' compact-card' : ''}${cls.optional ? ' optional-class' : ''}${hasCourseNotes ? ' has-notes' : ''}${hasTimeslotNote ? ' has-timeslot-note' : ''}${hasTest ? ' has-test' : ''}${columnCount > 1 ? ' overlap-columns' : ''}`}
                      style={{
                        ...getOverlapEventStyle(event),
                        top: `${topPercent}%`,
                        height: `${heightPx}px`,
                      }}
                      title={`${primaryLabel}${!hasTest && display.short ? ` (${display.short})` : ''}${effectiveType === 'in-person' ? ` • ${effectiveRoom}` : ''} — Click for notes`}
                      role="button"
                      onClick={() => setNotesModal({ className: cls.name, test, cls, timeslotNote, eventType: effectiveType })}
                    >
                      {!isCompactCard && <span className="event-name">{primaryLabel}</span>}
                      {(isCompactCard || display.short) && (
                        <span className="event-short-wrap">
                          <span className="event-short">{isCompactCard ? compactLabel : display.short}</span>
                        </span>
                      )}
                      {effectiveType === 'in-person' && <span className="event-room">{getEffectiveLocation(cls, teachingWeek, attendanceByWeek)}</span>}
                    </div>
                  )
                })}
              </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="current-time-line-wrap" aria-hidden>
        <div
          className={`current-time-line${currentTime.isLive ? ' is-live' : ''}${!isCurrentWeek ? ' other-week' : ''}`}
          style={{
            top: `${currentTime.topPx}px`,
            '--time-line-dot-left': `${(Math.min(currentTime.dayIndex, dayCount - 1) / dayCount) * 100}%`,
          }}
        >
          <span className="current-time-line-left" aria-hidden />
          <span className="current-time-line-right" aria-hidden />
          <span className="current-time-dot" style={{ left: 'var(--time-line-dot-left)' }} />
        </div>
      </div>

      {notesModal && (
        <div
          className="notes-modal-overlay"
          onClick={() => setNotesModal(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="notes-modal-title"
        >
          <div className="notes-modal" onClick={(e) => e.stopPropagation()}>
            <div className="notes-modal-header">
              <div className="notes-modal-header-main">
                <h2 id="notes-modal-title" className="notes-modal-title">
                  {getClassDisplay({ name: notesModal.className, optional: optionalClassNames.has(notesModal.className) }, classTitles).title} — Notes
                </h2>
                {notesModal.cls
                  && (!isClassEventInPast({ cls: notesModal.cls })
                    || notesModalMeetingLinks.showTeams
                    || notesModalMeetingLinks.showWhatsapp) && (
                  <div className="notes-modal-toolbar">
                    {!isClassEventInPast({ cls: notesModal.cls }) && (
                      <button
                        type="button"
                        className="calendar-action-btn hw-modal-calendar-btn notes-modal-calendar-btn"
                        onClick={() => addClassToCalendar({ cls: notesModal.cls, test: notesModal.test })}
                        aria-label="Add to calendar"
                        title="Add to calendar"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden>
                          <path d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1a3 3 0 0 1 3 3v11a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V7a3 3 0 0 1 3-3h1V3a1 1 0 0 1 1-1zm13 9H4v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7zM5 6a1 1 0 0 0-1 1v2h16V7a1 1 0 0 0-1-1H5z" />
                        </svg>
                        Add to calendar
                      </button>
                    )}
                    {notesModalMeetingLinks.showTeams && (
                      <a
                        className="notes-modal-link-btn notes-modal-link-btn--teams"
                        href={notesModalMeetingLinks.teamsHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open in Microsoft Teams"
                      >
                        <TeamsGlyph />
                        Teams
                      </a>
                    )}
                    {notesModalMeetingLinks.showWhatsapp && (
                      <a
                        className="notes-modal-link-btn notes-modal-link-btn--whatsapp"
                        href={notesModalMeetingLinks.whatsappHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Link on WhatsApp"
                        title={(notesModal.cls?.onlineNote || '').replace(/\n/g, ' ')}
                      >
                        <WhatsAppGlyph />
                        Link on WhatsApp
                      </a>
                    )}
                  </div>
                )}
                {notesModalSchedule && (
                  <div className="notes-modal-schedule">
                    <p className="notes-modal-schedule-time">{notesModalSchedule.time}</p>
                    {notesModalSchedule.room && (
                      <p className="notes-modal-schedule-room">{notesModalSchedule.room}</p>
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="notes-modal-close"
                onClick={() => setNotesModal(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="notes-modal-body">
              {notesModal.test && (
                <div className="test-notes">
                  <div className="test-notes-title">{notesModal.test.title}</div>
                  <pre className="notes-modal-content">{renderNoteText(notesModal.test.notes || '')}</pre>
                </div>
              )}
              {notesModal.timeslotNote && (
                <div className={`timeslot-notes timeslot-notes--${notesModal.eventType || 'in-person'}`}>
                  <pre className="notes-modal-content">{renderNoteText(notesModal.timeslotNote)}</pre>
                </div>
              )}
              {courseNotes[notesModal.className] && (
                <pre className="notes-modal-content">{renderNoteText(courseNotes[notesModal.className])}</pre>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default Calendar
