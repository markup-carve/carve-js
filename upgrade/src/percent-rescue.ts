import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineStart, lineText, readLines } from './source.ts'

interface Rescue {
  output: string
  record: ReportRecord
}

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

function percentBoundaryCandidates(output: string): string[] {
  const lines = output.split('\n')
  const found: string[] = []
  for (let open = 1; open < lines.length - 2; open++) {
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

/** C2-B-108, C2-B-110 and C2-B-114: outgrow a closer 0.1 kept inside the comment. */
export function rescuePercent(input: string, output: string, mismatch: ReportRecord): Rescue | null {
  if (!input.includes('%%%')) return null
  const expected = html01(input)
  for (const candidate of percentBoundaryCandidates(output)) {
    try {
      if (!compareHtml(expected, html02(candidate, false)).equal) continue
      return { output: candidate, record: recordOf('U-129', mismatch.line,
        'the comment fence and follower were moved to their 0.2 ownership columns') }
    } catch { /* A candidate can fail to parse under the new grammar. */ }
  }
  const lines = readLines(output)
  const near = Math.max(1, mismatch.line)
  for (let line = Math.max(1, near - 4); line <= Math.min(lines.count, near + 4); line++) {
    const value = lineText(lines, line)
    const run = percentRun(value)
    if (run < 3) continue
    const start = lineStart(lines, line) + value.length - value.trimStart().length
    if (value.trim() === '%'.repeat(run)) {
      for (let indent = 1; indent <= 8; indent++) {
        const candidate = output.slice(0, lineStart(lines, line)) + ' '.repeat(indent) + value.trimStart()
          + output.slice(lineStart(lines, line) + value.length)
        try {
          if (!compareHtml(expected, html02(candidate, false)).equal) continue
          return { output: candidate, record: recordOf('U-129', mismatch.line,
            'the comment closer was moved to its owning column while preserving 0.1 HTML') }
        } catch { /* A candidate can fail to parse under the new grammar. */ }
      }
    }
    for (let length = run + 1; length <= Math.max(8, run + 3); length++) {
      const candidate = output.slice(0, start) + '%'.repeat(length) + output.slice(start + run)
      try {
        if (!compareHtml(expected, html02(candidate, false)).equal) continue
        return { output: candidate, record: recordOf('U-129', mismatch.line,
          'the comment fence was lengthened to retain the 0.1 opaque body') }
      } catch { /* A candidate can fail to parse under the new grammar. */ }
    }
  }
  return null
}
