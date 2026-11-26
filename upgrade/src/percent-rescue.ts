import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineStart, lineText, readLines } from './source.ts'

interface Rescue {
  output: string
  record: ReportRecord
}

// A line block opener at the end of a line, behind any container markers (C2-B-123).
const LINE_BLOCK_OPENER = /:{3,}[ \t]*\|[ \t]*$/u

function percentRun(text: string): number {
  const start = text.length - text.trimStart().length
  let at = start
  while (text.charCodeAt(at) === 0x25) at++
  return at - start
}

function percentCloser(lines: string[], open: number): number {
  for (let at = open + 1; at < Math.min(lines.length, open + 12); at++) {
    if ((lines[at] ?? '').trim() === '%%%') return at
  }
  return -1
}

function candidateWindow(count: number, near: number): [number, number] {
  return count <= 128 ? [0, count] : [Math.max(0, near - 24), Math.min(count, near + 24)]
}

function percentBoundaryCandidates(output: string, near: number): string[] {
  const lines = output.split('\n')
  const found: string[] = []
  const [first, last] = candidateWindow(lines.length, near)
  for (let open = Math.max(1, first); open < Math.min(last, lines.length - 2); open++) {
    if (!(lines[open] ?? '').trimStart().startsWith('%%%')) continue
    const close = percentCloser(lines, open)
    if (close < 0 || (lines[close + 1] ?? '').trim() === '') continue
    const follower = [...lines]
    follower[close + 1] = (follower[close + 1] ?? '').trimStart()
    found.push(follower.join('\n'))
    for (let indent = 2; indent <= 4; indent++) {
      const moved = [...lines]
      for (let at = open; at <= close; at++) {
        if ((moved[at] ?? '').trim() !== '') moved[at] = ' '.repeat(indent) + (moved[at] ?? '').trimStart()
      }
      found.push(moved.join('\n'))
    }
  }
  return found
}

function firstPreserving(expected: string, candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (compareHtml(expected, html02(candidate, false)).equal) return candidate
    } catch {
      /* A candidate can fail to parse under the new grammar. */
    }
  }
  return null
}

function percentLineCandidates(
  output: string,
  lines: ReturnType<typeof readLines>,
  line: number
): { indented: string[]; followed: string[]; lengthened: string[] } {
  const value = lineText(lines, line)
  const run = percentRun(value)
  const indented: string[] = []
  const followed: string[] = []
  const lengthened: string[] = []
  if (run < 3) return { indented, followed, lengthened }
  const lineAt = lineStart(lines, line)
  const start = lineAt + value.length - value.trimStart().length
  if (value.trim() === '%'.repeat(run)) {
    for (let indent = 1; indent <= 8; indent++) {
      indented.push(
        output.slice(0, lineAt) + ' '.repeat(indent) + value.trimStart() + output.slice(lineAt + value.length)
      )
    }
    // C2-B-024, C2-B-123: an unclosed comment block in a line block body takes no lazy line in 0.2, so the lines
    // 0.1 hid in it move to its column with it.
    const above = line > 1 ? lineText(lines, line - 1) : ''
    for (let indent = 1; indent <= 8 && LINE_BLOCK_OPENER.test(above); indent++) {
      const moved = withLazyFollowers(output, lineAt, indent)
      if (moved !== null) followed.push(moved)
    }
  }
  for (let length = run + 1; length <= Math.max(8, run + 3); length++) {
    lengthened.push(output.slice(0, start) + '%'.repeat(length) + output.slice(start + run))
  }
  return { indented, followed, lengthened }
}

/** The percent line at `lineAt` and the non-blank lines below it up to a blank, each indented less than `indent`, moved to `indent`. */
function withLazyFollowers(output: string, lineAt: number, indent: number): string | null {
  const lines = output.slice(lineAt).split('\n')
  let moved = false
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]!
    if (line.trim() === '') break
    const lead = line.length - line.trimStart().length
    if (lead >= indent) continue
    lines[at] = ' '.repeat(indent) + line.trimStart()
    if (at > 0) moved = true
  }
  return moved ? output.slice(0, lineAt) + lines.join('\n') : null
}

function opaqueSpanCandidates(input: string, near: number): string[] {
  const lines = input.split('\n')
  const found: string[] = []
  const [first, last] = candidateWindow(lines.length, near)
  for (let open = first; open < Math.min(last, lines.length - 2); open++) {
    if (!(lines[open] ?? '').includes('%%%')) continue
    for (let close = open + 1; close < Math.min(lines.length - 1, open + 12); close++) {
      if (!(lines[close] ?? '').includes('%%%')) continue
      const changed = [...lines]
      changed.splice(open, close - open + 1)
      found.push(changed.join('\n'))
    }
  }
  return found
}

function bareQuotedPercent(value: string): boolean {
  let run = value.trimStart()
  while (run.startsWith('>')) run = run.slice(1).trimStart()
  return run.length >= 3 && [...run].every((character) => character === '%')
}

function duplicatedPercentCandidates(output: string, near: number): string[] {
  const lines = output.split('\n')
  const found: string[] = []
  const [first, last] = candidateWindow(lines.length, near)
  for (let at = first; at < Math.min(last, lines.length - 1); at++) {
    if (!bareQuotedPercent(lines[at] ?? '') || !bareQuotedPercent(lines[at + 1] ?? '')) continue
    if (bareQuotedPercent(lines[at - 1] ?? '') || bareQuotedPercent(lines[at + 2] ?? '')) continue
    const changed = [...lines]
    changed.splice(at + 2, 0, lines[at + 1] ?? '')
    found.push(changed.join('\n'))
  }
  return found
}

/** C2-B-108, C2-B-110 and C2-B-111, C2-B-112: outgrow a closer 0.1 kept inside the comment. */
export function rescuePercent(input: string, output: string, mismatch: ReportRecord): Rescue | null {
  if (!input.includes('%%%')) return null
  const expected = html01(input)
  const boundary = firstPreserving(expected, percentBoundaryCandidates(output, mismatch.line))
  if (boundary !== null)
    return {
      output: boundary,
      record: recordOf(
        'U-129',
        mismatch.line,
        'the comment fence and follower were moved to their 0.2 ownership columns'
      )
    }
  const lines = readLines(output)
  const near = Math.max(1, mismatch.line)
  for (let line = Math.max(1, near - 4); line <= Math.min(lines.count, near + 4); line++) {
    const candidates = percentLineCandidates(output, lines, line)
    const indented = firstPreserving(expected, candidates.indented)
    if (indented !== null)
      return {
        output: indented,
        record: recordOf(
          'U-129',
          mismatch.line,
          'the comment closer was moved to its owning column while preserving 0.1 HTML'
        )
      }
    const lengthened = firstPreserving(expected, candidates.lengthened)
    if (lengthened !== null)
      return {
        output: lengthened,
        record: recordOf('U-129', mismatch.line, 'the comment fence was lengthened to retain the 0.1 opaque body')
      }
  }
  const duplicated = firstPreserving(expected, duplicatedPercentCandidates(output, mismatch.line))
  if (duplicated !== null) return { output: duplicated, record: recordOf('U-129', mismatch.line,
    'a second comment fence boundary was written to retain the 0.1 hidden quote content') }
  const opaque = firstPreserving(expected, opaqueSpanCandidates(input, mismatch.line))
  if (opaque !== null) return { output: opaque, record: recordOf('U-215', mismatch.line,
    'the invisible percent fence span was removed so the surrounding blocks keep their 0.1 ownership') }
  for (let line = Math.max(1, near - 4); line <= Math.min(lines.count, near + 4); line++) {
    const followed = firstPreserving(expected, percentLineCandidates(output, lines, line).followed)
    if (followed !== null) return { output: followed, record: recordOf('U-129', mismatch.line,
      'the unclosed comment fence and the lines 0.1 hid in it were moved to its owning column') }
  }
  return null
}
