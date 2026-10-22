export interface MarkdownReferenceDefinition {
  label: string
  target: string
  lines: number
  complex: boolean
}

/** Read a top-level reference definition before converting its inline text. */
export function readMarkdownReferenceDefinition(source: string): MarkdownReferenceDefinition | null {
  const opener = /^ {0,3}\[/.exec(source)
  if (!opener) return null
  let at = opener[0].length
  const labelStart = at
  for (; at < source.length; at++) {
    if (source[at] === '\\') { at++; continue }
    if (source[at] === '[') return null
    if (source[at] === ']') break
  }
  const label = source.slice(labelStart, at)
  if (!label.trim() || /\n[ \t]*\n/.test(label) || label.length > 999 || source[at + 1] !== ':') return null
  at += 2
  while (/[ \t]/.test(source[at] ?? '\0')) at++
  if (source[at] === '\n') {
    at++
    while (/[ \t]/.test(source[at] ?? '\0')) at++
  }
  const destinationStart = at
  if (source[at] === '<') {
    at++
    for (; at < source.length; at++) {
      if (source[at] === '\\') { at++; continue }
      if (source[at] === '<' || source[at] === '\n') return null
      if (source[at] === '>') break
    }
    if (source[at] !== '>') return null
    at++
  } else {
    let depth = 0
    for (; at < source.length && !/[\x00-\x20\x7f]/.test(source[at]!); at++) {
      if (source[at] === '\\' && /[!-\/:-@\[-`{-~]/.test(source[at + 1] ?? '')) { at++; continue }
      if (source[at] === '(' && ++depth > 32) return null
      if (source[at] === ')' && --depth < 0) return null
    }
    if (depth !== 0 || at === destinationStart || source[destinationStart] === '<') return null
  }
  const destination = source.slice(destinationStart, at)
  const destinationEnd = at
  while (/[ \t]/.test(source[at] ?? '\0')) at++
  if (source[at] === '\n') {
    at++
    while (/[ \t]/.test(source[at] ?? '\0')) at++
  }
  const destinationOnly = (): MarkdownReferenceDefinition | null => {
    let end = destinationEnd
    while (/[ \t]/.test(source[end] ?? '\0')) end++
    if (end < source.length && source[end] !== '\n') return null
    return { label, target: destination, lines: source.slice(0, end).split('\n').length, complex: /\n|\\\]/.test(label) }
  }
  let title: string | undefined
  let titleSource = ''
  const quote = source[at]
  if (at > destinationEnd && (quote === '"' || quote === "'" || quote === '(')) {
    const close = quote === '(' ? ')' : quote
    const titleStart = ++at
    for (; at < source.length; at++) {
      if (source[at] === '\\') { at++; continue }
      if (quote === '(' && source[at] === '(') return destinationOnly()
      if (source[at] === '\n' && /^\n[ \t]*\n/.test(source.slice(at))) return destinationOnly()
      if (source[at] === close) break
    }
    if (source[at] !== close) return destinationOnly()
    title = source.slice(titleStart, at++)
    titleSource = quote === '('
      ? ' \"' + title.replace(/\\([!-\/:-@\[-`{-~])/g, '$1').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
      : ' ' + source.slice(titleStart - 1, at)
    while (/[ \t]/.test(source[at] ?? '\0')) at++
    if (at < source.length && source[at] !== '\n') return destinationOnly()
  } else {
    at = destinationEnd
    while (/[ \t]/.test(source[at] ?? '\0')) at++
    if (at < source.length && source[at] !== '\n') return destinationOnly()
  }
  return {
    label,
    target: destination + titleSource,
    lines: source.slice(0, at).split('\n').length,
    complex: /\n|\\\]/.test(label) || (title !== undefined && title.includes('\n')),
  }
}
