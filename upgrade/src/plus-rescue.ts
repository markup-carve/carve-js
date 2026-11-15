import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineEnd, lineStart, lineText, readLines, type Lines } from './source.ts'

interface Rescue {
  output: string
  record: ReportRecord
}

function plusEntry(source: string): string {
  const line = source.split('\n').find((value) => value.includes('+'))?.trimStart() ?? ''
  if (line.startsWith('[^') || line.includes(']: +')) return 'U-124'
  if (line === '+' && source.includes('[^') && source.includes(']:')) return 'U-177'
  if (line.startsWith('::') || line.startsWith(':')) return 'U-123'
  if (line.startsWith('- ') || line.startsWith('* ') || line.startsWith('. ')) return 'U-122'
  if (line.startsWith('>')) return 'U-125'
  return 'U-122'
}

function hasStructuralPlus(source: string): boolean {
  const lines = source.split('\n')
  const markers = ['- ', '* ', '. ', '>', ':', '[^']
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trimStart()
    if (line.endsWith('+') && markers.some((mark) => line.startsWith(mark))) return true
    if (line !== '+') continue
    const above = lines.slice(Math.max(0, index - 3), index).join('\n')
    if (markers.some((mark) => above.includes(mark))) return true
  }
  return false
}

function replaceLine(source: string, line: number, replacement: string): string {
  const lines = readLines(source)
  return source.slice(0, lineStart(lines, line)) + replacement + source.slice(lineEnd(lines, line))
}

function removeLine(source: string, line: number): string {
  const lines = readLines(source)
  return source.slice(0, lineStart(lines, line)) + source.slice(lineStart(lines, line + 1))
}

function blankCandidates(source: string, lines: Lines, mismatchLine: number, found: Set<string>): void {
  for (let line = 2; line <= lines.count; line++) {
    if (Math.abs(line - mismatchLine) > 6) continue
    if (lineText(lines, line - 1).trim() === '' || lineText(lines, line).trim() === '') continue
    const at = lineStart(lines, line)
    found.add(source.slice(0, at) + '\n' + source.slice(at))
    if (source.includes('[^')) found.add(source.slice(0, at) + '\n{% %}\n' + source.slice(at))
  }
  for (let line = 2; line <= lines.count; line++) {
    if (Math.abs(line - mismatchLine) > 6) continue
    const value = lineText(lines, line)
    if (!value.trimStart().startsWith('{') || lineText(lines, line - 1).trim() !== '') continue
    for (const indent of [0, 2, 3, 4, 5, 6, 7, 8, 1]) {
      found.add(replaceLine(source, line, ' '.repeat(indent) + value.trimStart()))
    }
  }
}

function plusAtLine(source: string, lines: Lines, line: number, found: Set<string>): void {
  const current = lineText(lines, line)
  const plus = current.lastIndexOf('+')
  if (plus < 0) return
  const without = current.slice(0, plus) + current.slice(plus + 1)
  found.add(source.slice(0, lineStart(lines, line)) + '\n' + source.slice(lineStart(lines, line)))
  found.add(replaceLine(source, line, without.trimEnd()))
  found.add(replaceLine(source, line, current.slice(0, plus) + '{% %}' + current.slice(plus + 1)))
  if (current.trim() === '+') found.add(replaceLine(source, line, '\n{% %}'))
  if (line < lines.count) {
    const next = lineText(lines, line + 1)
    for (let indent = 0; indent <= 12; indent++) {
      const moved = replaceLine(source, line + 1, ' '.repeat(indent) + next.trimStart())
      found.add(replaceLine(moved, line, current.slice(0, plus).trimEnd()))
      found.add(replaceLine(moved, line, ''))
    }
  }
  found.add(removeLine(source, line))
}

function plusCandidates(source: string, lines: Lines, mismatchLine: number, found: Set<string>): void {
  for (let line = 1; line <= lines.count; line++) {
    if (Math.abs(line - mismatchLine) > 6) continue
    plusAtLine(source, lines, line, found)
  }
}

function quoteBlankCandidates(source: string, lines: Lines, mismatchLine: number, found: Set<string>): void {
  for (let line = 2; line <= lines.count; line++) {
    if (Math.abs(line - mismatchLine) > 6) continue
    if (lineText(lines, line).trimStart() === '> +' && lineText(lines, line - 1).trimStart().startsWith('>')) {
      const at = lineStart(lines, line)
      found.add(source.slice(0, at) + '>\n' + source.slice(at))
    }
    if (lineText(lines, line).trim() !== '') continue
    if (lineText(lines, line - 1).trim().startsWith('>') && lineText(lines, line + 1).trim().startsWith('>')) {
      found.add(removeLine(source, line))
    }
  }
}

function nestedQuoteCandidates(source: string): string[] {
  const found: string[] = []
  const lines = readLines(source)
  for (let line = 2; line < lines.count; line++) {
    const current = lineText(lines, line)
    if (current.trim() !== '+' || !lineText(lines, line - 1).includes('- >')) continue
    const next = lineText(lines, line + 1)
    const indent = current.slice(0, current.length - current.trimStart().length)
    const moved = replaceLine(source, line + 1, `${indent}> ${next.trimStart()}`)
    found.push(replaceLine(moved, line, `${indent}>`))
  }
  return found
}

function nestedMarkedQuoteCandidates(source: string): string[] {
  const found: string[] = []
  const lines = readLines(source)
  for (let line = 2; line < lines.count; line++) {
    if (lineText(lines, line).trimStart() !== '> +') continue
    if (!lineText(lines, line - 1).trimStart().startsWith('> >')) continue
    const next = lineText(lines, line + 1).trimStart()
    if (!next.startsWith('> ')) continue
    const moved = replaceLine(source, line + 1, '> ' + next)
    found.push(replaceLine(moved, line, '> >'))
  }
  return found
}

function listDivCandidates(source: string): string[] {
  const found: string[] = []
  const lines = readLines(source)
  for (let line = 2; line < lines.count; line++) {
    if (lineText(lines, line).trim() !== '+') continue
    const next = lineText(lines, line + 1).trimStart()
    for (let open = Math.max(1, line - 3); open < line; open++) {
      const value = lineText(lines, open)
      const at = value.indexOf(':::')
      if (at < 0 || !value.slice(0, at).includes('- ') && !value.slice(0, at).includes('. ')) continue
      const moved = replaceLine(source, line + 1, ' '.repeat(at) + next)
      found.push(replaceLine(moved, line, ' '.repeat(at) + ':::'))
    }
  }
  return found
}

function listPlusColumn(value: string): number {
  const trimmed = value.trimStart()
  if (!trimmed.startsWith('- +') && !trimmed.startsWith('* +') && !trimmed.startsWith('. +')) return -1
  return value.length - trimmed.length + 2
}

function isSibling(value: string, markerColumn: number): boolean {
  const trimmed = value.trimStart()
  const indent = value.length - trimmed.length
  if (indent > markerColumn) return false
  return trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('. ')
    || trimmed.startsWith('# ') || trimmed.startsWith(':::') || trimmed.startsWith(':: ')
}

function indentListPlus(source: string): string[] {
  const lines = source.split('\n')
  const found: string[] = []
  for (let at = 0; at < lines.length - 1; at++) {
    const column = listPlusColumn(lines[at] ?? '')
    if (column < 0) continue
    let end = at + 1
    while (end < Math.min(lines.length, at + 14) && !isSibling(lines[end] ?? '', column - 2)) end++
    if (end === at + 1) continue
    let least = column
    for (let line = at + 1; line < end; line++) {
      const value = lines[line] ?? ''
      if (value.trim() !== '') least = Math.min(least, value.length - value.trimStart().length)
    }
    const moved = [...lines]
    moved[at] = (lines[at] ?? '').slice(0, column) + '{% %}'
    for (let line = at + 1; line < end; line++) {
      if (moved[line]?.trim() !== '') moved[line] = ' '.repeat(column - least) + moved[line]
    }
    found.push(moved.join('\n'))
  }
  return found
}

function candidates(source: string, mismatchLine: number): string[] {
  const lines = readLines(source)
  const found = new Set<string>()
  blankCandidates(source, lines, mismatchLine, found)
  plusCandidates(source, lines, mismatchLine, found)
  quoteBlankCandidates(source, lines, mismatchLine, found)
  found.delete(source)
  return [...found]
}

export function rescuePlus(input: string, output: string, mismatch: ReportRecord): Rescue | null {
  if (!hasStructuralPlus(input)) return null
  const entry = plusEntry(input)
  const expected = html01(input)
  const variants = [...candidates(output, Math.max(1, mismatch.line)), ...nestedQuoteCandidates(input),
    ...nestedMarkedQuoteCandidates(input), ...listDivCandidates(input), ...indentListPlus(output)]
  for (const candidate of variants) {
    try {
      if (!compareHtml(expected, html02(candidate, false)).equal) continue
      return { output: candidate, record: recordOf(entry, mismatch.line,
        'the continuation marker was replaced with 0.2 block ownership while preserving 0.1 HTML') }
    } catch { /* Candidate is not a 0.2 document. */ }
  }
  return null
}
