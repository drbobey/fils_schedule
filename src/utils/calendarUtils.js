function pad(value) {
  return String(value).padStart(2, '0')
}

function formatDateStamp(date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
}

function formatDateTimeStamp(date) {
  return `${formatDateStamp(date)}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
}

function escapeIcsText(value = '') {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

function buildIcsContent({
  title,
  description = '',
  location = '',
  startDate,
  endDate,
  allDay = false,
}) {
  const now = new Date()
  const uid = `fils-schedule-${now.getTime()}-${Math.random().toString(16).slice(2)}@local`
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FILS Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatDateTimeStamp(now)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(location)}`,
  ]

  if (allDay) {
    const nextDay = new Date(endDate)
    nextDay.setDate(nextDay.getDate() + 1)
    lines.push(`DTSTART;VALUE=DATE:${formatDateStamp(startDate)}`)
    lines.push(`DTEND;VALUE=DATE:${formatDateStamp(nextDay)}`)
  } else {
    lines.push(`DTSTART:${formatDateTimeStamp(startDate)}`)
    lines.push(`DTEND:${formatDateTimeStamp(endDate)}`)
  }

  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n')
}

function buildMultiEventIcsContent(events) {
  const now = new Date()
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FILS Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]

  events.forEach((event, index) => {
    const uid = `fils-schedule-${now.getTime()}-${index}-${Math.random().toString(16).slice(2)}@local`
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${uid}`)
    lines.push(`DTSTAMP:${formatDateTimeStamp(now)}`)
    lines.push(`SUMMARY:${escapeIcsText(event.title)}`)
    lines.push(`DESCRIPTION:${escapeIcsText(event.description || '')}`)
    lines.push(`LOCATION:${escapeIcsText(event.location || '')}`)

    if (event.allDay) {
      const nextDay = new Date(event.endDate)
      nextDay.setDate(nextDay.getDate() + 1)
      lines.push(`DTSTART;VALUE=DATE:${formatDateStamp(event.startDate)}`)
      lines.push(`DTEND;VALUE=DATE:${formatDateStamp(nextDay)}`)
    } else {
      lines.push(`DTSTART:${formatDateTimeStamp(event.startDate)}`)
      lines.push(`DTEND:${formatDateTimeStamp(event.endDate)}`)
    }

    const reminders = Array.isArray(event.remindersMinutes) ? event.remindersMinutes : []
    reminders
      .filter((minutes) => Number.isFinite(minutes) && minutes > 0)
      .forEach((minutes) => {
        lines.push('BEGIN:VALARM')
        lines.push(`TRIGGER:-PT${Math.floor(minutes)}M`)
        lines.push('ACTION:DISPLAY')
        lines.push(`DESCRIPTION:${escapeIcsText(event.title)}`)
        lines.push('END:VALARM')
      })

    const absoluteReminders = Array.isArray(event.absoluteReminderDateTimes) ? event.absoluteReminderDateTimes : []
    absoluteReminders
      .filter((date) => date instanceof Date && !Number.isNaN(date.getTime()))
      .forEach((date) => {
        lines.push('BEGIN:VALARM')
        lines.push(`TRIGGER;VALUE=DATE-TIME:${formatDateTimeStamp(date)}`)
        lines.push('ACTION:DISPLAY')
        lines.push(`DESCRIPTION:${escapeIcsText(event.title)}`)
        lines.push('END:VALARM')
      })

    lines.push('END:VEVENT')
  })

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

export function downloadCalendarEvent({
  title,
  description = '',
  location = '',
  startDate,
  endDate,
  allDay = false,
  filename = 'event.ics',
}) {
  const content = buildIcsContent({
    title,
    description,
    location,
    startDate,
    endDate,
    allDay,
  })

  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function downloadCalendarEvents(events, filename = 'events.ics') {
  if (!Array.isArray(events) || events.length === 0) return

  const content = buildMultiEventIcsContent(events)
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
