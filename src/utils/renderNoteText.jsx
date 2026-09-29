import React from 'react'

const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)<]+)/g

export default function renderNoteText(text) {
  if (!text) return null
  const parts = []
  let lastIndex = 0
  let match
  const re = new RegExp(LINK_RE.source, 'g')
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const label = match[1] || match[3]
    const url = match[2] || match[3]
    parts.push(
      <a key={match.index} href={url} target="_blank" rel="noopener noreferrer" className="note-link">
        {label}
      </a>
    )
    lastIndex = re.lastIndex
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}
