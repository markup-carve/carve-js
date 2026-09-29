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
  if (!label.trim() || label.length > 999 || source[at + 1] !== ':') return null
  at += 2
  while (/[ \t\n]/.test(source[at] ?? '\0')) at++
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
  let title: string | undefined
  const quote = source[at]
  if (at > destinationEnd && (quote === '"' || quote === "'" || quote === '(')) {
    const close = quote === '(' ? ')' : quote
    const titleStart = ++at
    for (; at < source.length; at++) {
      if (source[at] === '\\') { at++; continue }
      if (quote === '(' && source[at] === '(') return null
      if (source[at] === close) break
    }
    if (source[at] !== close) return null
    title = source.slice(titleStart, at++)
    while (/[ \t]/.test(source[at] ?? '\0')) at++
    if (at < source.length && source[at] !== '\n') return null
  } else {
    at = destinationEnd
    while (/[ \t]/.test(source[at] ?? '\0')) at++
    if (at < source.length && source[at] !== '\n') return null
  }
  const titleSource = title === undefined ? '' : ` "${title.replace(/(?<!\\)"/g, '\\"')}"`
  return {
    label,
    target: destination + titleSource,
    lines: source.slice(0, at).split('\n').length,
    complex: /\n|\\\]/.test(label) || (title !== undefined && title.includes('\n')),
  }
}
