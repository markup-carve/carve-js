export interface MarkdownBareLink {
  start: number
  end: number
  prefix: string
  body?: string
  tail?: string
}

const hostCharacter = (value: string): boolean => !/[\s\p{P}]/u.test(value) && !/[!-/:-@\[-`{-~]/.test(value)

function domainAllowed(text: string, start: number, end: number, short: boolean): boolean {
  if (start >= end || !hostCharacter(text[start]!)) return false
  if ((text.codePointAt(start) ?? 0) > 0x7f) return short
  let dots = 0, previousUnderscores = 0, underscores = 0
  for (let i = start + 1; i < end - 1; i++) {
    if (text[i] === '\\' && i < end - 2) i++
    const char = text[i]!
    if (char.charCodeAt(0) > 0x7f) break
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

function scanBareLinks(text: string, mode: 'all' | 'url' | 'email'): MarkdownBareLink[] {
  const links: MarkdownBareLink[] = []
  const triggers = /https?:\/\/|ftp:\/\/|www\.|@/gi
  let contextAt = 0, bracketDepth = 0
  let chunkEnd = 0
  let retry: { at: number; dots: number; resource: boolean; autoMailto: boolean } | undefined
  scan: for (let match = triggers.exec(text); match; match = triggers.exec(text)) {
    while (contextAt < match.index) {
      if (text[contextAt] === '\\' && /[!-/:-@\[-`{-~]/.test(text[contextAt + 1] ?? '')) { contextAt += 2; continue }
      if (text[contextAt] === '[') bracketDepth++
      else if (text[contextAt] === ']' && bracketDepth > 0) bracketDepth--
      contextAt++
    }
    if ((bracketDepth > 0 && match[0] !== '@') || (/^www\./i.test(match[0]) && match[0] !== 'www.')) continue
    let start = match.index, end = triggers.lastIndex
    let prefix = ''
    if (match[0] === '@') {
      if (mode === 'url') continue
      const carried = retry?.at === match.index ? retry : undefined
      retry = undefined
      let resource = carried?.resource ?? false
      let autoMailto = carried?.autoMailto ?? true
      const floor = links.at(-1)?.end ?? 0
      while (start > floor) {
        if (/[A-Za-z0-9.+_-]/.test(text[start - 1]!)) { start--; continue }
        if (text[start - 1] === ':') {
          const scheme = ['mailto:', 'xmpp:'].find(value => {
            const before = start - value.length
            return before >= floor && text.slice(before, start) === value && !/[A-Za-z0-9]/.test(text[before - 1] ?? '')
          })
          if (scheme) { start--; autoMailto = false; resource ||= scheme === 'xmpp:'; continue }
        }
        break
      }
      if (start === match.index) continue
      let dots = carried?.dots ?? 0
      while (end < text.length) {
        const char = text[end]!
        if (char === '@') { retry = { at: end, dots, resource, autoMailto }; triggers.lastIndex = end; continue scan }
        if (/[A-Za-z0-9_-]/.test(char) || (resource && char === '/')) { end++; continue }
        if (char === '.' && /[A-Za-z0-9]/.test(text[end + 1] ?? '')) { dots++; end++; continue }
        break
      }
      if (dots === 0 || !/[A-Za-z]/.test(text[end - 1] ?? '')) continue
      prefix = autoMailto ? 'mailto:' : ''
    } else {
      if (mode === 'email') continue
      const www = match[0] === 'www.'
      if (www && start > 0 && !/[ \t\r\n\f\v*_~(]/.test(text[start - 1]!)) continue
      if (!www && /[A-Za-z]/.test(text[start - 1] ?? '')) continue
      if (end >= chunkEnd) {
        chunkEnd = end
        while (chunkEnd < text.length && !/[ \t\r\n\f\v<\x00]/.test(text[chunkEnd]!)) chunkEnd++
      }
      if (!domainAllowed(text, www ? start : triggers.lastIndex, text.length, !www)) continue
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

export function markdownBareLinks(
  text: string,
  escapedSource?: (token: string) => string | undefined,
  mode: 'all' | 'url' | 'email' = 'all',
): MarkdownBareLink[] {
  if (!escapedSource || !text.includes('\x00')) return scanBareLinks(text, mode)
  const pieces: { value: string; start: number; end: number; offset: number; escaped: boolean }[] = []
  let cursor = 0, offset = 0
  const append = (value: string, start: number, end: number, escaped = false): void => {
    pieces.push({ value, start, end, offset, escaped })
    offset += value.length
  }
  for (const token of text.matchAll(/\x00P\d+\x00/g)) {
    if (token.index > cursor) append(text.slice(cursor, token.index), cursor, token.index)
    const restored = escapedSource(token[0])
    append(restored ?? token[0], token.index, token.index + token[0].length, restored !== undefined)
    cursor = token.index + token[0].length
  }
  if (cursor < text.length) append(text.slice(cursor), cursor, text.length)
  const expanded = pieces.map(piece => piece.value).join('')
  let pieceAt = 0
  const locate = (position: number): typeof pieces[number] => {
    while (pieceAt + 1 < pieces.length && position >= pieces[pieceAt]!.offset + pieces[pieceAt]!.value.length) pieceAt++
    return pieces[pieceAt]!
  }
  return scanBareLinks(expanded, mode).map(link => {
    const first = locate(link.start)
    const start = first.escaped ? first.start : first.start + link.start - first.offset
    const last = locate(link.end)
    const inside = link.end - last.offset
    const end = last.escaped && inside > 0 ? last.end : last.start + inside
    return {
      start,
      end,
      prefix: link.prefix,
      body: expanded.slice(link.start, link.end),
      tail: last.escaped && inside > 0 ? last.value.slice(inside) : '',
    }
  })
}
