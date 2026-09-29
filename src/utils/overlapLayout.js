/** True when two half-open intervals [start, end) overlap. */
export function eventsOverlap(a, b) {
  return a.start < b.end && b.start < a.end
}

/**
 * Assign column index and columnCount per event (Outlook-style side-by-side layout).
 * Events are grouped into overlap clusters; within each cluster, greedy left-to-right placement.
 */
export function layoutOverlappingEvents(events) {
  if (!events.length) return []

  const sorted = [...events].sort(
    (a, b) => a.start - b.start || a.end - b.end || (a.id || '').localeCompare(b.id || '')
  )

  const clusters = []
  let cluster = [sorted[0]]
  let clusterEnd = sorted[0].end

  for (let i = 1; i < sorted.length; i++) {
    const e = sorted[i]
    if (e.start < clusterEnd) {
      cluster.push(e)
      clusterEnd = Math.max(clusterEnd, e.end)
    } else {
      clusters.push(cluster)
      cluster = [e]
      clusterEnd = e.end
    }
  }
  clusters.push(cluster)

  const laidOut = []

  for (const group of clusters) {
    const columns = []
    const clusterEvents = []

    for (const event of group) {
      let placedCol = -1
      for (let col = 0; col < columns.length; col++) {
        if (!columns[col].some((other) => eventsOverlap(event, other))) {
          placedCol = col
          columns[col].push(event)
          break
        }
      }
      if (placedCol === -1) {
        placedCol = columns.length
        columns.push([event])
      }
      clusterEvents.push({ ...event, column: placedCol })
    }

    const columnCount = columns.length
    for (const event of clusterEvents) {
      laidOut.push({ ...event, columnCount })
    }
  }

  return laidOut
}

/** Pixel inset and gap between adjacent columns in a day cell. */
export const OVERLAP_LAYOUT_INSET_PX = 2
export const OVERLAP_LAYOUT_GAP_PX = 1

export function getOverlapEventStyle(event) {
  const { column, columnCount } = event
  if (columnCount <= 1) {
    return {
      left: `${OVERLAP_LAYOUT_INSET_PX}px`,
      right: `${OVERLAP_LAYOUT_INSET_PX}px`,
    }
  }

  const inset = OVERLAP_LAYOUT_INSET_PX
  const gap = OVERLAP_LAYOUT_GAP_PX
  const track = `100% - ${inset * 2}px`
  const colWidth = `calc((${track}) / ${columnCount} - ${gap}px)`
  const left = `calc(${inset}px + ${column} * ((${track}) / ${columnCount} + ${gap}px))`

  return { left, width: colWidth, right: 'auto' }
}
