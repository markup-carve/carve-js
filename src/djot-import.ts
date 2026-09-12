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

function splitSiteFrontmatter(source: string): [string, string, string] {
  const lines = source.split('\n')
  if (!/^--- ?\w*[ \t]*$/.test(lines[0] ?? '')) return ['', '', source]
  for (let i = 1; i < lines.length; i++) {
    if (/^---[ \t]*$/.test(lines[i]!)) {
      const frontmatter = lines.slice(0, i + 1).join('\n')
      const offset = frontmatter.length
      const separator = source.startsWith('\n\n', offset) ? '\n\n' : source.startsWith('\n', offset) ? '\n' : ''
      return [frontmatter, separator, source.slice(offset + separator.length)]
    }
  }
  return ['', '', source]
}

function leadingIndent(line: string): [number, number] {
  let columns = 0
  let chars = 0
  while (chars < line.length && (line[chars] === ' ' || line[chars] === '\t')) {
    columns = line[chars] === '\t' ? columns + (4 - columns % 4) : columns + 1
    chars++
  }
  return [columns, chars]
}

function charsThroughColumns(line: string, wanted: number): number {
  let columns = 0
  let chars = 0
  while (chars < line.length && columns < wanted && (line[chars] === ' ' || line[chars] === '\t')) {
    columns = line[chars] === '\t' ? columns + (4 - columns % 4) : columns + 1
    chars++
  }
  return chars
}

/** Translate Djot definition-item structure without touching unrelated source. */
function convertDefinitionLists(source: string): string {
  const lines = source.split('\n')
  const masked = maskDjotCodeAndDestinations(source).split('\n')
  const stack: Array<{ source: number; target: number; body: boolean; ready: boolean }> = []
  for (let i = 0; i < lines.length; i++) {
    const term = /^([ \t]*):[ \t]+(\S.*)$/.exec(masked[i] ?? '')
    if (term) {
      const [indent] = leadingIndent(term[1]!)
      while (stack.length && indent < stack.at(-1)!.source) stack.pop()
      const top = stack.at(-1)
      const mayStart = top !== undefined || i === 0 || lines[i - 1]!.trim() === ''
      if (mayStart) {
        const authoredTerm = /^([ \t]*):[ \t]+(\S.*)$/.exec(lines[i]!)
        const termText = authoredTerm?.[2] ?? term[2]!
        if (!top || indent === top.source) {
          const target = top?.target ?? indent
          if (!top) stack.push({ source: indent, target, body: false, ready: false })
          else {
            top.body = false
            top.ready = false
          }
          const prefix = ' '.repeat(target)
          lines[i] = `${top ? '' : `${prefix}{loose}\n`}${prefix}:: ${termText}`
          continue
        }
        if (top.ready && indent >= top.source + 2) {
          const target = top.target + 3
          const lead = top.body ? ' '.repeat(target) : `${' '.repeat(top.target)}:  `
          top.body = true
          lines[i] = `${lead}{loose}\n${' '.repeat(target)}:: ${termText}`
          stack.push({ source: indent, target, body: false, ready: false })
          continue
        }
      }
    }
    if (!stack.length) continue
    if (lines[i]!.trim() === '') {
      stack.at(-1)!.ready = true
      continue
    }
    if (!stack.at(-1)!.ready) continue
    const [indent] = leadingIndent(lines[i]!)
    while (stack.length && indent < stack.at(-1)!.source + 2) stack.pop()
    const context = stack.at(-1)
    if (!context) continue
    const payload = lines[i]!.slice(charsThroughColumns(lines[i]!, context.source + 2))
    const extra = Math.max(0, indent - context.source - 2)
    lines[i] = context.body
      ? `${' '.repeat(context.target + 3 + extra)}${payload}`
      : `${' '.repeat(context.target)}:  ${' '.repeat(extra)}${payload}`
    context.body = true
  }
  return lines.join('\n')
}

/** Rewrite Djot block spellings that Carve does not recognize. */
function convertDjotBlockMarkers(source: string): string {
  const lines = source.split('\n')
  const masked = maskDjotCodeAndDestinations(source).split('\n')
  const isNestedAt = (line: number, quote: string, columns: number): boolean => {
    for (let j = line - 1; j >= 0; j--) {
      if (!(masked[j] ?? '').startsWith(quote)) break
      const candidate = (masked[j] ?? '').slice(quote.length)
      if (candidate.trim() === '') continue
      const [candidateColumns] = leadingIndent(candidate)
      if (candidateColumns >= columns) continue
      if (/^(?:([*-])[ \t]*){3,}$/.test(candidate.trim())) return false
      return /^(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\)|:)[ \t]+\S/.test(candidate.trimStart())
    }
    return false
  }
  for (let i = 0; i < lines.length; i++) {
    if ((masked[i] ?? '').trim() === '') continue
    const enclosed = /^((?:[ \t]*>[ \t]*)*)([ \t]*)\(([0-9A-Za-z]+)\)([ \t]+\S.*)$/.exec(masked[i]!)
    if (enclosed) {
      const authored = /^((?:[ \t]*>[ \t]*)*)([ \t]*)\(([0-9A-Za-z]+)\)([ \t]+\S.*)$/.exec(lines[i]!)
      const [columns] = leadingIndent(enclosed[2]!)
      if (authored) lines[i] = `${authored[1]}${isNestedAt(i, enclosed[1]!, columns) ? authored[2] : ''}${authored[3]}.${authored[4]}`
      continue
    }
    const rule = /^((?:[ \t]*>[ \t]*)*)([ \t]*)([*-])(?:[ \t]*\3){2,}[ \t]*$/.exec(masked[i]!)
    if (!rule) continue
    const quote = rule[1]!
    const indent = rule[2]!
    const [columns] = leadingIndent(indent)
    const nested = isNestedAt(i, quote, columns)
    lines[i] = `${quote}${nested ? indent : ''}***`
  }
  return lines.join('\n')
}

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
  const [frontmatter, separator, body] = splitSiteFrontmatter(normalized)
  const converted = collapseFalseListBoundaries(
    applyMigrationFixes(escapePlainDjotText(convertDefinitionLists(convertDjotBlockMarkers(body)))).output,
  )
  return frontmatter === '' ? converted : `${frontmatter}${separator}${converted}`
}
