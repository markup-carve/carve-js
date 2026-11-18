import map from '../../v2/data/upgrade-map.json' with { type: 'json' }
import { compareHtmlExact } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineOf, readLines } from './source.ts'
import { newMapCandidates } from './new-map-candidates.ts'
import { newMapRange, replayMapRange } from './new-map-ranges.ts'

const REWRITE_IDS = new Set([
  'U-278', 'U-280', 'U-281',
  'U-284', 'U-285', 'U-286', 'U-290', 'U-300', 'U-304', 'U-305', 'U-340', 'U-365', 'U-366',
  'U-367', 'U-368', 'U-369', 'U-375', 'U-376', 'U-377', 'U-390',
])
const REPORT_IDS = new Set([
  'U-262', 'U-263', 'U-264', 'U-271', 'U-279', 'U-282', 'U-283', 'U-287', 'U-288', 'U-289',
  'U-249', 'U-291', 'U-292', 'U-293', 'U-301', 'U-302', 'U-303', 'U-341', 'U-362', 'U-364', 'U-370', 'U-371',
  'U-378', 'U-379', 'U-380', 'U-381', 'U-382', 'U-383', 'U-384', 'U-385', 'U-386', 'U-387',
  'U-388', 'U-389', 'U-391', 'U-393', 'U-394', 'U-395',
])

const BY_SOURCE = new Map(map.source.filter((row) => REWRITE_IDS.has(row.id)).map((row) => [row.from, row]))
const REPORTS = new Map(map.source.filter((row) => REPORT_IDS.has(row.id)).map((row) => [row.from, row]))

/** Exact catalog examples have a promised spelling; accept it only when both renderers confirm it. */
export function mappedRewrite(input: string): { output: string; record: ReportRecord } | null {
  const row = BY_SOURCE.get(input)
  const additional = newMapCandidates(input)
  if (row === undefined && additional.length === 0) return null
  // A candidate is unnecessary when the authored spelling already has the old HTML.
  if (row === undefined) {
    try { if (compareHtmlExact(html01(input), html02(input, false)).equal) return null } catch { /* Check candidates below. */ }
  }
  const candidates = row !== undefined && row.to !== input
    ? [{ id: row.id, output: row.to }, ...additional] : additional
  for (const candidate of candidates) {
    try {
      if (!compareHtmlExact(html01(input), html02(candidate.output, false)).equal) continue
      return { output: candidate.output, record: recordOf(candidate.id, 1,
        row?.id === candidate.id ? row.meaning02 : 'the source has a preserving 0.2 spelling') }
    } catch { /* A candidate is not accepted without both engine renders. */ }
  }
  return null
}

/** A kept difference remains visible even when a small example happens to render alike. */
export function mappedReport(input: string): ReportRecord | null {
  const row = REPORTS.get(input)
  if (row === undefined) return null
  const range = newMapRange(input, row.id)
  return range === undefined ? recordOf(row.id, 1, row.meaning02)
    : { ...recordOf(row.id, lineOf(readLines(input), range.startOffset), row.meaning02), range }
}

/** A residual HTML difference in a larger source can still cite its mapped construct. */
export function mappedRemainderReport(input: string, old: string, next: string): ReportRecord | null {
  const found = replayMapRange(input, old, next)
  if (found === null) return null
  const row = map.source.find((item) => item.id === found.id)
  if (row === undefined) return null
  return { ...recordOf(found.id, lineOf(readLines(input), found.range.startOffset), row.meaning02), range: found.range }
}

/** U-249 remains an explicit review row even though HTML names now compare without case. */
export function mathClassReport(input: string): ReportRecord | null {
  const match = /\$`[^`\n]*`(\{CLASS=[^}\n]+\})/u.exec(input)
  if (match?.index === undefined || match[1] === undefined) return null
  const startOffset = match.index + match[0].indexOf(match[1])
  return { ...recordOf('U-249', lineOf(readLines(input), startOffset),
    'the inline math class key uses its canonical lowercase name in 0.2'),
  range: { startOffset, endOffset: startOffset + match[1].length } }
}
