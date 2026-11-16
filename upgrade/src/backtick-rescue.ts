// U-258, U-259 and the closing run of U-190: candidate spellings that the complete HTML check decides.
import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'

export interface Candidate {
  id: string
  output: string
}

/** A line that ends the paragraph above it in 0.2: a blank line, or a fence line, which opens its block there. */
function endsParagraph(text: string, start: number): boolean {
  if (start >= text.length || text[start] === '\n') return true
  const line = text.slice(start, text.indexOf('\n', start) < 0 ? text.length : text.indexOf('\n', start)).trimStart()
  return line.startsWith('```') || line.startsWith(':::')
}

/** The offsets of the line ends of the paragraph that holds `at`. */
function paragraphLineEnds(text: string, at: number): number[] {
  const ends: number[] = []
  let end = text.indexOf('\n', at)
  while (end >= 0) {
    ends.push(end)
    if (endsParagraph(text, end + 1)) return ends
    end = text.indexOf('\n', end + 1)
  }
  ends.push(text.length)
  return ends
}

function runLength(text: string, at: number): number {
  let end = at
  while (text[end] === '`') end++
  return end - at
}

/** The offset of a run of exactly `length` backticks after `from`, before `limit`, or -1. */
function closingRun(text: string, from: number, limit: number, length: number): number {
  for (let at = from; at < limit; at++) {
    if (text[at] !== '`') continue
    const run = runLength(text, at)
    if (run === length) return at
    at += run - 1
  }
  return -1
}

/**
 * C2-I-017, U-258: a backtick run with no closing run of its length in its content is text in 0.2, where 0.1 read code
 * to the end of the content. Each candidate closes the first such run at one line end of its paragraph.
 */
export function closedRunCandidates(output: string, id = 'U-258'): Candidate[] {
  const found: Candidate[] = []
  for (let at = 0; at < output.length; at++) {
    if (output[at] === '\\') {
      at++
      continue
    }
    if (output[at] !== '`') continue
    const length = runLength(output, at)
    const ends = paragraphLineEnds(output, at)
    const limit = ends[ends.length - 1] ?? output.length
    const close = closingRun(output, at + length, limit, length)
    if (close >= 0) {
      at = close + length - 1
      continue
    }
    const mark = '`'.repeat(length)
    for (const end of ends) found.push({ id, output: output.slice(0, end) + mark + output.slice(end) })
    return found
  }
  return found
}

/** C2-B-173, C2-B-174, U-259: a span mark alone in a cell that cannot join is removed, which leaves an empty cell. */
export function spanMarkCandidates(output: string): Candidate[] {
  const found: Candidate[] = []
  const lines = output.split('\n')
  lines.forEach((line, index) => {
    if (!line.trimStart().startsWith('|')) return
    for (const shape of ['|= ^|', '|= <|', '| ^|', '| <|', '|=^|', '|=<|']) {
      const at = line.indexOf(shape)
      if (at < 0) continue
      const changed = [...lines]
      changed[index] = line.slice(0, at) + shape.replace(/[\^<]/, '') + line.slice(at + shape.length)
      found.push({ id: 'U-259', output: changed.join('\n') })
    }
  })
  return found
}

/** The first candidate whose 0.2 HTML is the 0.1 HTML of `input`. */
export function rescueBacktick(input: string, output: string, mismatch: ReportRecord,
  extra: readonly Candidate[] = []): { output: string, record: ReportRecord } | null {
  const expected = html01(input)
  for (const candidate of [...closedRunCandidates(output), ...spanMarkCandidates(output), ...extra]) {
    try {
      if (!compareHtml(expected, html02(candidate.output, false)).equal) continue
      const message = 'the clause-backed spelling preserves the complete 0.1 HTML'
      return { output: candidate.output, record: recordOf(candidate.id, mismatch.line, message) }
    } catch {
      continue
    }
  }
  return null
}
