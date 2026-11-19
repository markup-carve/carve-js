import map from '../../data/upgrade-map.json' with { type: 'json' }
import { compareHtmlExact } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { type Context } from './context.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineOf, readLines } from './source.ts'
import { newMapCandidates } from './new-map-candidates.ts'
import { newMapRange, replayMapRange } from './new-map-ranges.ts'

const REWRITE_IDS = new Set([
  'U-278', 'U-280', 'U-281',
  'U-284', 'U-285', 'U-286', 'U-290', 'U-300', 'U-304', 'U-305', 'U-340', 'U-365', 'U-366',
  'U-367', 'U-368', 'U-369', 'U-375', 'U-376', 'U-377',
  'U-399', 'U-400', 'U-401', 'U-402', 'U-405', 'U-406', 'U-407',
])
const REPORT_IDS = new Set([
  'U-262', 'U-263', 'U-264', 'U-271', 'U-279', 'U-282', 'U-283', 'U-287', 'U-288', 'U-289',
  'U-249', 'U-291', 'U-292', 'U-293', 'U-301', 'U-302', 'U-303', 'U-341', 'U-362', 'U-364', 'U-370', 'U-371',
  'U-378', 'U-379', 'U-380', 'U-381', 'U-382', 'U-383', 'U-384', 'U-385', 'U-386', 'U-387',
  'U-388', 'U-389', 'U-391', 'U-394', 'U-395',
  'U-397', 'U-398', 'U-403', 'U-404', 'U-408', 'U-409', 'U-410', 'U-411',
  'U-414', 'U-415', 'U-417', 'U-419',
])

const BY_SOURCE = new Map(map.source.filter((row) => REWRITE_IDS.has(row.id)).map((row) => [row.from, row]))
const REPORTS = new Map<string, typeof map.source>()
for (const row of map.source.filter((item) => REPORT_IDS.has(item.id))) {
  const list = REPORTS.get(row.from) ?? []
  list.push(row)
  REPORTS.set(row.from, list)
}

function rendersLikeOld(input: string, candidate: string): boolean {
  try { return compareHtmlExact(html01(input), html02(candidate, false)).equal } catch { return false }
}

/** Exact catalog examples have a promised spelling; accept it only when both renderers confirm it. */
export function mappedRewrite(input: string): { output: string; record: ReportRecord } | null {
  const row = BY_SOURCE.get(input)
  const additional = newMapCandidates(input)
  if (row === undefined && additional.length === 0) return null
  // A candidate is unnecessary when the authored spelling already has the old HTML.
  if (row === undefined && rendersLikeOld(input, input)) return null
  const candidates = row !== undefined && row.to !== input
    ? [{ id: row.id, output: row.to }, ...additional] : additional
  for (const candidate of candidates) {
    if (!rendersLikeOld(input, candidate.output)) continue
    return { output: candidate.output, record: recordOf(candidate.id, 1,
      row?.id === candidate.id ? row.meaning02 : 'the source has a preserving 0.2 spelling') }
  }
  return null
}

/** A kept difference remains visible even when a small example happens to render alike. */
export function mappedReport(input: string): ReportRecord[] {
  return (REPORTS.get(input) ?? []).map((row) => {
    const range = newMapRange(input, row.id) ?? (Number(row.id.slice(2)) >= 397
      ? { startOffset: 0, endOffset: input.length } : undefined)
    return range === undefined ? recordOf(row.id, 1, row.meaning02)
      : { ...recordOf(row.id, lineOf(readLines(input), range.startOffset), row.meaning02), range }
  })
}

/** A residual HTML difference in a larger source can still cite its mapped construct. */
export function mappedRemainderReport(input: string, old: string, next: string, differenceLine: number): ReportRecord | null {
  const found = replayMapRange(input, old, next)
  if (found === null) return null
  const row = map.source.find((item) => item.id === found.id)
  if (row === undefined) return null
  const line = lineOf(readLines(input), found.range.startOffset)
  if (differenceLine > 0 && Math.abs(line - differenceLine) > 5) return null
  return { ...recordOf(found.id, line, row.meaning02), range: found.range }
}

/** U-249 remains an explicit review row even though HTML names now compare without case. */
export function mathClassReport(ctx: Context): ReportRecord | null {
  for (const match of ctx.src.matchAll(/\$`[^`\n]*`(\{CLASS=[^}\n]+\})/gu)) {
    if (match.index === undefined || match[1] === undefined) continue
    const end = match.index + match[0].length
    const parsedMath = ctx.visits.some(({ node }) => node.type === 'math'
      && node.pos?.startOffset === match.index && node.pos.endOffset >= end)
    if (!parsedMath) continue
    const startOffset = end - match[1].length
    return { ...recordOf('U-249', lineOf(ctx.lines, startOffset),
      'the inline math class key uses its canonical lowercase name in 0.2'),
    range: { startOffset, endOffset: end } }
  }
  return null
}
