/* Convert Djot source to Carve without treating it as already-Carve source. */

import { escapePlainCarveInlineSyntax, HANDLED_DJOT } from './carve-escape.js'
import { applyMigrationFixes, maskDjotCodeAndDestinations } from './djot-migrate.js'

const fencedLines = (lines: readonly string[]): boolean[] => {
  let fence: { ch: string; len: number } | null = null
  return lines.map((line) => {
    if (fence) {
      const close = /^ {0,3}([`~]{3,})[ \t]*$/.exec(line)
      if (close?.[1]?.[0] === fence.ch && close[1].length >= fence.len) fence = null
      return true
    }
    const open = /^(\s*)(`{3,}|~{3,})\s*([a-zA-Z0-9_+#.-]*)\s*$/.exec(line)
    if (!open) return false
    fence = { ch: open[2]![0]!, len: open[2]!.length }
    return true
  })
}

const quoted = (line: string): [number, string] => {
  let depth = 0
  let content = line
  while (true) {
    const prefix = /^[ \t]*>[ ]?/.exec(content)
    if (!prefix) return [depth, content]
    depth++
    content = content.slice(prefix[0].length)
  }
}

const isMarkerLine = (line: string): boolean =>
  /^[ \t]*(?:[-*+]|[0-9A-Za-z]+[.)])[ \t]+\S/.test(line)

/** Keep a Djot loose list from becoming two Carve lists after 3+ blank lines. */
function collapseFalseListBoundaries(source: string): string {
  const lines = source.split('\n')
  const fenced = fencedLines(lines)
  const parts = lines.map(quoted)
  const result: string[] = []

  for (let i = 0; i < lines.length; i++) {
    if (fenced[i] || parts[i]![1].trim() !== '') {
      result.push(lines[i]!)
      continue
    }
    const depth = parts[i]![0]
    let end = i
    while (
      end + 1 < lines.length && !fenced[end + 1] &&
      parts[end + 1]![0] === depth && parts[end + 1]![1].trim() === ''
    ) end++
    const next = end + 1
    let above = i - 1
    while (above >= 0 && parts[above]![1].trim() === '') above--
    if (
      end - i + 1 >= 3 && next < lines.length && !fenced[next] &&
      parts[next]![0] === depth && isMarkerLine(parts[next]![1]) &&
      above >= 0 && parts[above]![0] === depth &&
      (isMarkerLine(parts[above]![1]) || /^[ \t]/.test(parts[above]![1]))
    ) {
      result.push(lines[i]!)
      i = end
      continue
    }
    for (let k = i; k <= end; k++) result.push(lines[k]!)
    i = end
  }
  return result.join('\n')
}

/** Escape plain Djot text while leaving code spans, fences and destinations opaque. */
function escapePlainDjotText(source: string): string {
  const masked = maskDjotCodeAndDestinations(source)
  let output = ''
  let plain = ''
  for (let i = 0; i < source.length; i++) {
    if (masked[i] === ' ' && source[i] !== '\n') {
      if (plain !== '') {
        output += escapePlainCarveInlineSyntax(plain, HANDLED_DJOT)
        plain = ''
      }
      output += source[i]
    } else plain += source[i]
  }
  return output + escapePlainCarveInlineSyntax(plain, HANDLED_DJOT)
}

/** Convert a Djot document to Carve source. */
export function djotToCarve(djot: string): string {
  const normalized = djot.replace(/\r\n?/g, '\n')
  const escaped = escapePlainDjotText(normalized)
  return collapseFalseListBoundaries(applyMigrationFixes(escaped).output)
}
