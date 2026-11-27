import { lint } from '../../lint/lint.ts'
import { entryOf, type ReportRecord } from './report.ts'

function linesOfBytes(input: string): (offset: number) => number {
  const bytes = new TextEncoder().encode(input)
  const starts: number[] = [0]
  for (let at = bytes.indexOf(10); at >= 0; at = bytes.indexOf(10, at + 1)) starts.push(at + 1)
  return (offset) => {
    let low = 0
    let high = starts.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (starts[middle]! <= offset) low = middle + 1
      else high = middle
    }
    return low
  }
}

/**
 * An entry with several lint rules names, on each record, the one that fires nearest the record's line
 * (C2-W-156 migration notices); the first rule stays when none of them fires.
 */
export function nameFiringLints(input: string, records: readonly ReportRecord[]): void {
  const several = records.filter((record) => record.lint !== undefined && entryLints(record.entry).length > 1)
  if (several.length === 0) return
  let found: { code: string; line: number }[]
  try {
    const lineOf = linesOfBytes(input)
    found = lint(input, { upgrade: true }).filter((entry) => entry.file === undefined)
      .map((entry) => ({ code: entry.code, line: lineOf(entry.range?.startOffset ?? 0) }))
  } catch { return }
  for (const record of several) {
    const rule = nearestRule(entryLints(record.entry), record.line, found)
    if (rule !== undefined) record.lint = rule
  }
}

function nearestRule(rules: readonly string[], line: number, found: readonly { code: string; line: number }[]): string | undefined {
  let best: { rank: number; distance: number } | null = null
  for (const finding of found) {
    const rank = rules.indexOf(finding.code)
    if (rank < 0) continue
    const distance = line > 0 ? Math.abs(finding.line - line) : 0
    if (best === null || distance < best.distance || (distance === best.distance && rank < best.rank)) best = { rank, distance }
  }
  return best === null ? undefined : rules[best.rank]
}

function entryLints(id: string): readonly string[] {
  try { return entryOf(id).lint } catch { return [] }
}
