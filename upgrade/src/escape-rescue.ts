// U-430: a delimiter 0.1 read as text that 0.2 pairs is escaped (C2-I-010); the complete HTML check decides.
import { compareHtmlExact } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'

const DELIMITERS = new Set([...'*/_~=^+-{}[]<>!`|:'])
const MAX_SINGLE = 40
const MAX_PAIR = 14

function escapeAt(text: string, offsets: readonly number[]): string {
  let out = text
  for (const at of [...offsets].sort((a, b) => b - a)) out = `${out.slice(0, at)}\\${out.slice(at)}`
  return out
}

/** Offsets of unescaped delimiters on line `line` (from 1) of `text`. */
function delimiterOffsets(text: string, line: number): number[] {
  const lines = text.split('\n')
  if (line < 1 || line > lines.length) return []
  let start = 0
  for (let index = 0; index < line - 1; index++) start += lines[index]!.length + 1
  const end = start + lines[line - 1]!.length
  const found: number[] = []
  for (let at = start; at < end; at++) {
    if (text[at] === '\\') {
      at++
      continue
    }
    if (DELIMITERS.has(text[at]!)) found.push(at)
  }
  return found
}

export function rescueEscape(input: string, output: string, mismatch: ReportRecord): { output: string; record: ReportRecord } | null {
  if (mismatch.line < 1) return null
  // A paragraph difference is placed on its first line; the opener 0.2 reads may stand on the next.
  const offsets = [...delimiterOffsets(output, mismatch.line), ...delimiterOffsets(output, mismatch.line + 1)]
  if (offsets.length === 0 || offsets.length > MAX_SINGLE) return null
  const expected = html01(input)
  const keeps = (candidate: string): boolean => {
    try { return compareHtmlExact(expected, html02(candidate, false)).equal } catch { return false }
  }
  const sets: number[][] = offsets.map((at) => [at])
  if (offsets.length <= MAX_PAIR) {
    for (let first = 0; first < offsets.length; first++) {
      for (let second = first + 1; second < offsets.length; second++) sets.push([offsets[first]!, offsets[second]!])
    }
  }
  for (const set of sets) {
    const candidate = escapeAt(output, set)
    if (keeps(candidate)) {
      return { output: candidate, record: recordOf('U-430', mismatch.line,
        'a delimiter 0.2 pairs and 0.1 read as text is escaped, which keeps the complete 0.1 HTML') }
    }
  }
  return null
}
