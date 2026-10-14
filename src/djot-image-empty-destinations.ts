import { maskDjotCodeAndDestinations, isDjotEscaped } from './djot-migrate.js'

export function djotImageEmptyDestinations(source: string): string {
  if (!source.includes('](')) return source
  const empty = new Map<number, number>()
  const mask = maskDjotCodeAndDestinations(source, true, true, true, undefined, [], {
    onDestination: (start, end) => {
      if (/^[ \t\r\n]*$/.test(source.slice(start + 1, end - 1))) empty.set(start, end)
    },
  })
  if (!empty.size) return source
  const brackets: number[] = []
  const removed = new Uint8Array(source.length)
  for (let at = 0; at < source.length; at++) {
    if (mask[at] !== source[at] || isDjotEscaped(source, at)) continue
    if (source[at] === '[') brackets.push(at)
    else if (source[at] === ']') {
      const open = brackets.pop(), end = empty.get(at + 1)
      if (open === undefined || end === undefined || source[open + 1] === '^') continue
      removed[open] = 1
      removed.fill(1, at, end)
      if (source[open - 1] === '!' && !isDjotEscaped(source, open - 1)) removed[open - 1] = 1
    }
  }
  const parts: string[] = []
  let cursor = 0
  for (let at = 0; at < source.length; at++) if (removed[at]) {
    parts.push(source.slice(cursor, at)); cursor = at + 1
  }
  return parts.join('') + source.slice(cursor)
}
