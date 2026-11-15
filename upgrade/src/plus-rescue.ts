import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineEnd, lineStart, lineText, readLines, type Lines } from './source.ts'

interface Rescue {
  output: string
  record: ReportRecord
}

function plusEntry(source: string): string {
  const lines = source.split('\n')
  const at = lines.findIndex((value) => value.includes('+'))
  const line = lines[at]?.trimStart() ?? ''
  if (line.startsWith('[^') || line.includes(']: +')) return 'U-124'
  if (line === '+') return standalonePlusEntry(source, lines, at)
  if (line.startsWith('::') || line.startsWith(':')) return 'U-123'
  if (line.startsWith('- ') || line.startsWith('* ') || line.startsWith('. ')) return 'U-122'
  if (line.startsWith('>')) return 'U-125'
  return 'U-122'
}

function standalonePlusEntry(source: string, lines: string[], at: number): string {
  if (source.includes('[^') && source.includes(']:')) return 'U-177'
  const before = lines.slice(0, at).reverse().find((value) => value.trim() !== '')?.trimStart() ?? ''
  if (before.startsWith('>')) return 'U-125'
  if (before.startsWith(':')) return 'U-123'
  return 'U-122'
}

function hasStructuralPlus(source: string): boolean {
  const lines = source.split('\n')
  const markers = ['- ', '* ', '. ', '>', ':', '[^']
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trimStart()
    if (firstBlockColumn(line) >= 0) return true
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

function footnoteFencePlus(source: string): string[] {
  const lines = source.split('\n')
  const found: string[] = []
  for (let at = 0; at < lines.length - 2; at++) {
    const definition = (lines[at] ?? '').trimStart()
    if (!definition.startsWith('[^') || !definition.endsWith(']: +')) continue
    if ((lines[at + 1] ?? '').trim() !== '```') continue
    const close = lines.findIndex((line, index) => index > at + 1 && line.trim() === '```')
    if (close < 0 || close > at + 20) continue
    const moved = [...lines]
    moved[at] = (lines[at] ?? '').slice(0, -1) + '```'
    moved.splice(at + 1, 1)
    for (let line = at + 1; line < close; line++) moved[line] = '  ' + moved[line]
    found.push(moved.join('\n'))
  }
  return found
}

function listQuotePlus(source: string): string[] {
  const lines = source.split('\n')
  const found: string[] = []
  for (let at = 2; at < lines.length - 1; at++) {
    const marker = lines[at] ?? ''
    if (marker.trim() !== '+') continue
    const quote = lines[at - 1] ?? ''
    const indent = marker.length - marker.trimStart().length
    if (quote.slice(0, indent) !== marker.slice(0, indent) || !quote.slice(indent).startsWith('> ')) continue
    const item = (lines[at - 2] ?? '').trimStart()
    if (!item.startsWith('- ') && !item.startsWith('* ') && !item.startsWith('. ')) continue
    const moved = [...lines]
    moved[at] = marker.slice(0, indent) + '>'
    moved[at + 1] = marker.slice(0, indent) + '> ' + (lines[at + 1] ?? '').trimStart()
    moved.splice(at - 1, 0, '')
    found.push(moved.join('\n'))
  }
  return found
}

function firstBlockColumn(value: string): number {
  if (!value.endsWith('+')) return -1
  const column = value.length - 1
  const marker = value.slice(0, column).trimStart()
  if (marker === '- ' || marker === '* ' || marker === '. ') return column
  let at = 0
  while (marker.charCodeAt(at) >= 0x30 && marker.charCodeAt(at) <= 0x39) at++
  return at > 0 && (marker[at] === '.' || marker[at] === ')') && marker[at + 1] === ' ' ? column : -1
}

function isFirstBlockOpener(value: string): boolean {
  if (value.startsWith('```') || value.startsWith(':::')) return true
  return value.startsWith('{') && value.endsWith('}') && !value.startsWith('{%')
}

function listFirstBlock(source: string): string[] {
  const lines = source.split('\n')
  const found: string[] = []
  for (let at = 0; at < lines.length - 2; at++) {
    const column = firstBlockColumn(lines[at] ?? '')
    if (column < 0) continue
    const opener = (lines[at + 1] ?? '').trimStart()
    if (!isFirstBlockOpener(opener)) continue
    for (let count = 1; count <= Math.min(12, lines.length - at - 2); count++) {
      const moved = [...lines]
      moved[at] = (lines[at] ?? '').slice(0, column) + opener
      moved.splice(at + 1, 1)
      let least = column
      for (let line = at + 1; line <= at + count; line++) {
        const value = moved[line] ?? ''
        if (value.trim() !== '') least = Math.min(least, value.length - value.trimStart().length)
      }
      const shift = column - least
      for (let line = at + 1; line <= at + count; line++) {
        if (moved[line]?.trim() !== '') moved[line] = ' '.repeat(shift) + moved[line]
      }
      found.push(moved.join('\n'))
    }
  }
  return found
}

function listOutsideFence(source: string): string[] {
  const lines = source.split('\n')
  const found: string[] = []
  for (let at = 0; at < lines.length - 2; at++) {
    const column = firstBlockColumn(lines[at] ?? '')
    if (column < 0 || (lines[at + 1] ?? '').trim() !== '```') continue
    const indent = (lines[at] ?? '').length - (lines[at] ?? '').trimStart().length
    const openIndent = (lines[at + 1] ?? '').length - (lines[at + 1] ?? '').trimStart().length
    if (openIndent <= indent) continue
    const close = nearbyFenceClose(lines, at)
    if (close < 0) continue
    const moved = [...lines]
    moved[at] = (lines[at] ?? '').slice(0, column) + '{% %}'
    for (let line = at + 1; line <= close; line++) {
      const value = moved[line] ?? ''
      moved[line] = value.slice(Math.min(openIndent - indent, value.length - value.trimStart().length))
    }
    found.push(moved.join('\n'))
  }
  return found
}

function nearbyFenceClose(lines: string[], open: number): number {
  for (let line = open + 2; line <= Math.min(lines.length - 1, open + 15); line++) {
    if (lines[line]?.trim() === '```') return line
  }
  return -1
}

function listCommentHeading(source: string): string[] {
  const lines = source.split('\n')
  const found: string[] = []
  for (let at = 0; at < lines.length - 2; at++) {
    const column = firstBlockColumn(lines[at] ?? '')
    if (column < 0) continue
    const comment = (lines[at + 1] ?? '').trim()
    if (!comment.startsWith('{%') || !comment.endsWith('%}')) continue
    const heading = (lines[at + 2] ?? '').trimStart()
    if (!heading.startsWith('# ')) continue
    const moved = [...lines]
    moved[at] = (lines[at] ?? '').slice(0, column) + '{% %}'
    moved.splice(at + 1, 1)
    moved[at + 1] = '\n' + ' '.repeat(column) + heading
    found.push(moved.join('\n'))
  }
  return found
}

function taskListBoundaryPlus(source: string): string[] {
  const lines = source.split('\n')
  const found: string[] = []
  for (let at = 1; at < lines.length - 1; at++) {
    const value = lines[at] ?? ''
    if (value.trim() !== '+') continue
    const before = (lines[at - 1] ?? '').trimStart()
    if (!before.startsWith('- [ ]') && !before.startsWith('- [x]') && !before.startsWith('- [X]')) continue
    const after = (lines[at + 1] ?? '').trimStart()
    if (!after.startsWith('- ')) continue
    const moved = [...lines]
    moved[at] = '\n' + value.slice(0, value.indexOf('+')) + '{% %}'
    found.push(moved.join('\n'))
  }
  return found
}

function percentListPlus(source: string): string[] {
  const lines = source.split('\n')
  const found: string[] = []
  for (let at = 0; at < lines.length - 4; at++) {
    const column = firstBlockColumn(lines[at] ?? '')
    if (column < 0 || (lines[at + 1] ?? '').trim() !== '%%%') continue
    const close = lines.findIndex((line, index) => index > at + 1 && line.trim() === '%%%')
    if (close < 0 || close >= lines.length - 1) continue
    const follower = lines[close + 1] ?? ''
    if (follower.trim() === '') continue
    const moved = [...lines]
    moved[at] = (lines[at] ?? '').slice(0, column) + '{% %}'
    moved[close + 1] = ' '.repeat(column) + follower.trimStart()
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
    ...nestedMarkedQuoteCandidates(input), ...listDivCandidates(input), ...indentListPlus(output),
    ...footnoteFencePlus(input), ...listQuotePlus(input), ...listFirstBlock(input), ...listOutsideFence(input),
    ...listCommentHeading(input), ...taskListBoundaryPlus(input), ...percentListPlus(input)]
  for (const candidate of variants) {
    try {
      if (!compareHtml(expected, html02(candidate, false)).equal) continue
      return { output: candidate, record: recordOf(entry, mismatch.line,
        'the continuation marker was replaced with 0.2 block ownership while preserving 0.1 HTML') }
    } catch { /* Candidate is not a 0.2 document. */ }
  }
  return null
}
