export interface MarkdownBareLink {
  start: number
  end: number
  prefix: string
}

const hostCharacter = (value: string): boolean => !/[\s\p{P}]/u.test(value) && !/[!-/:-@\[-`{-~]/.test(value)

function domainAllowed(text: string, start: number, end: number, short: boolean): boolean {
  if (start >= end || !hostCharacter(text[start]!)) return false
  let dots = 0, previousUnderscores = 0, underscores = 0
  for (let i = start + 1; i < end - 1; i++) {
    const char = text[i]!
    if (char === '\\' && i + 1 < end) { i++; continue }
    if (char === '_') underscores++
    else if (char === '.') { dots++; previousUnderscores = underscores; underscores = 0 }
    else if (char !== '-' && !hostCharacter(char)) break
  }
  return (short || dots > 0) && (dots > 10 || previousUnderscores + underscores === 0)
}

function trimmedEnd(text: string, start: number, end: number): number {
  let opening = 0, closing = 0
  for (let i = start; i < end; i++) {
    if (text[i] === '(') opening++
    else if (text[i] === ')') closing++
  }
  while (end > start) {
    const last = text[end - 1]!
    if (last === ')' && closing > opening) { closing--; end--; continue }
    if (/[?!.,:*_~'"]/.test(last)) { end--; continue }
    if (last === ';') {
      let entity = end - 2
      while (entity > start && /[A-Za-z]/.test(text[entity]!)) entity--
      end = entity < end - 2 && text[entity] === '&' ? entity : end - 1
      continue
    }
    break
  }
  return end
}

export function markdownBareLinks(text: string): MarkdownBareLink[] {
  const links: MarkdownBareLink[] = []
  const triggers = /https?:\/\/|ftp:\/\/|www\.|@/gi
  let contextAt = 0, bracketDepth = 0
  let chunkEnd = 0
  for (let match = triggers.exec(text); match; match = triggers.exec(text)) {
    while (contextAt < match.index) {
      if (text[contextAt] === '[') bracketDepth++
      else if (text[contextAt] === ']' && bracketDepth > 0) bracketDepth--
      contextAt++
    }
    if ((bracketDepth > 0 && match[0] !== '@') || (/^www\./i.test(match[0]) && match[0] !== 'www.')) continue
    let start = match.index, end = triggers.lastIndex
    let prefix = ''
    if (match[0] === '@') {
      while (start > 0 && /[A-Za-z0-9.+_-]/.test(text[start - 1]!)) start--
      if (start === match.index) continue
      for (const scheme of ['mailto:', 'xmpp:']) {
        const before = start - scheme.length
        if (before >= 0 && text.slice(before, start) === scheme && !/[A-Za-z0-9]/.test(text[before - 1] ?? '')) {
          start = before
          prefix = scheme
          break
        }
      }
      let dots = 0
      while (end < text.length) {
        const char = text[end]!
        if (/[A-Za-z0-9_-]/.test(char)) { end++; continue }
        if (char === '.' && /[A-Za-z0-9]/.test(text[end + 1] ?? '')) { dots++; end++; continue }
        break
      }
      if (dots === 0 || !/[A-Za-z]/.test(text[end - 1] ?? '')) continue
      prefix = prefix === '' ? 'mailto:' : ''
    } else {
      const www = match[0] === 'www.'
      if (www && start > 0 && !/[\s*_~(]/.test(text[start - 1]!)) continue
      if (!www && /[A-Za-z]/.test(text[start - 1] ?? '')) continue
      if (end >= chunkEnd) {
        chunkEnd = end
        while (chunkEnd < text.length && !/[\s<\x00]/.test(text[chunkEnd]!)) chunkEnd++
      }
      if (!domainAllowed(text, www ? start : triggers.lastIndex, chunkEnd, !www)) continue
      end = chunkEnd
      end = trimmedEnd(text, start, end)
      if (www) prefix = 'http://'
    }
    links.push({ start, end, prefix })
    contextAt = end
    triggers.lastIndex = end
  }
  return links
}
