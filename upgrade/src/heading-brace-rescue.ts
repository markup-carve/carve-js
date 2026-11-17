import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'

interface Rescue { output: string; record: ReportRecord }

function escapedHeading(line: string): string | null {
  let markerEnd = 0
  while (line[markerEnd] === '#') markerEnd++
  if (markerEnd === 0 || line[markerEnd] !== ' ' || !line.includes('{#')) return null
  const closer = line.lastIndexOf('}')
  if (closer < 0 || line[closer - 1] === '\\') return null
  return line.slice(0, closer) + '\\' + line.slice(closer)
}

function escapedMalformed(output: string, expected: string): string | null {
  const all = output.replaceAll('{%~{#', '{%~\\{#')
  if (all !== output && compareHtml(expected, html02(all, false)).equal) return all
  let at = output.indexOf('{%~{#')
  for (let count = 0; at >= 0 && count < 8; count++) {
    const candidate = output.slice(0, at + 3) + '\\' + output.slice(at + 3)
    if (compareHtml(expected, html02(candidate, false)).equal) return candidate
    at = output.indexOf('{%~{#', at + 1)
  }
  return null
}

/** C2-I-119, C2-I-090: keep a tag visible inside a failed brace attribute. */
export function rescueHeadingBraceTag(input: string, output: string, mismatch: ReportRecord): Rescue | null {
  if (!input.includes('{#')) return null
  const expected = html01(input)
  const lines = output.split('\n')
  const all = lines.map((line) => escapedHeading(line) ?? line).join('\n')
  if (all !== output && compareHtml(expected, html02(all, false)).equal) {
    return { output: all, record: recordOf('U-256', mismatch.line,
      'the brace closers were escaped so the tags keep their 0.1 inline boundaries') }
  }
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]
    if (line === undefined) continue
    const escaped = escapedHeading(line)
    if (escaped === null) continue
    const moved = [...lines]
    moved[at] = escaped
    const candidate = moved.join('\n')
    if (!compareHtml(expected, html02(candidate, false)).equal) continue
    return { output: candidate, record: recordOf('U-256', mismatch.line,
      'the brace closer was escaped so the tag keeps its 0.1 inline boundary') }
  }
  const malformed = escapedMalformed(output, expected)
  if (malformed !== null) {
    return { output: malformed, record: recordOf('U-256', mismatch.line,
      'the failed inline brace opener was escaped so the tag keeps its 0.1 boundary') }
  }
  return null
}
