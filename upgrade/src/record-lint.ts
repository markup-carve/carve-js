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
 * An entry with several lint rules names, on each record, the one that fires on the record's line, or on the next
 * line when no other record of the entry stands there (C2-W-156 migration notices); else the first rule stays.
 */
export function nameFiringLints(input: string, records: readonly ReportRecord[]): void {
  const several = records.filter((record) => record.lint !== undefined && record.line > 0
    && entryLints(record.entry).length > 1)
  if (several.length === 0) return
  let found: { code: string; line: number }[]
  try {
    const lineOf = linesOfBytes(input)
    found = lint(input, { upgrade: true }).filter((entry) => entry.file === undefined)
      .map((entry) => ({ code: entry.code, line: lineOf(entry.range?.startOffset ?? 0) }))
  } catch { return }
  for (const record of several) {
    const rules = entryLints(record.entry)
    const next = records.some((other) => other.entry === record.entry && other.line === record.line + 1)
    const rule = firstFiring(rules, record.line, found) ?? (next ? undefined : firstFiring(rules, record.line + 1, found))
    if (rule !== undefined) record.lint = rule
  }
}

function firstFiring(rules: readonly string[], line: number, found: readonly { code: string; line: number }[]): string | undefined {
  return rules.find((rule) => found.some((finding) => finding.line === line && finding.code === rule))
}

function entryLints(id: string): readonly string[] {
  try { return entryOf(id).lint } catch { return [] }
}
