import { compareHtml } from './compare.ts'
import { type Context, type Finding, makeContext, type Rule } from './context.ts'
import { applyEdits, type Edit, offsetBefore, selectEdits } from './edits.ts'
import { ENGINE_01_VERSION, html01, html02 } from './engines.ts'
import { needsPerson, type ReportRecord } from './report.ts'
import { RULES } from './rules/index.ts'
import { lineOf, readLines } from './source.ts'

/** Report entries after which the HTML of 0.2 differs from the HTML of 0.1 by the contract. */
const HTML_CHANGING = new Set(['U-011', 'U-021', 'U-059', 'U-060', 'U-061', 'U-072', 'U-073', 'U-076', 'U-077'])

export interface UpgradeResult {
  /** The Carve 0.2 source. */
  output: string
  changed: boolean
  records: ReportRecord[]
  /** `pass`: the HTML is kept. `explained`: it differs and report entries say why. `mismatch`: it differs otherwise. */
  check: 'pass' | 'explained' | 'mismatch'
  /** The version of the 0.1 engine that read the input. */
  engine01: string
}

interface Rewritten {
  output: string
  records: ReportRecord[]
  edits: Edit[]
}

/**
 * One pass: every rule reads the 0.1 tree of the input, and the edits apply together. An edit
 * that collides with one of a lower entry id is left out and named in the report.
 */
function rewrite(input: string): Rewritten {
  const ctx: Context = makeContext(input)
  const failures: ReportRecord[] = []
  for (const rule of RULES) runRule(ctx, rule, failures)
  const collected: Edit[] = []
  for (const finding of ctx.findings) {
    if (finding.edit !== null) collected.push(finding.edit)
  }
  const edits = selectEdits(collected)
  const kept = new Set(edits)
  const records: ReportRecord[] = [...failures]
  for (const finding of ctx.findings) {
    if (finding.edit === null || kept.has(finding.edit)) records.push(finding.record)
    else records.push(conflict(finding))
  }
  return { output: applyEdits(input, edits), records, edits }
}

/** A rule that fails on a tree it did not expect leaves no edit behind, and the failure is reported. */
function runRule(ctx: Context, rule: Rule, failures: ReportRecord[]): void {
  const before = ctx.findings.length
  try {
    rule(ctx)
  } catch (error) {
    ctx.findings.length = before
    failures.push({ entry: 'upgrade-error', class: 'mismatch', line: 0, message: `the rule ${rule.name} failed: ${String(error)}` })
  }
}

function conflict(finding: Finding): ReportRecord {
  const message = `the change of ${finding.record.entry} gave way to a change of an earlier entry at the same place`
  return { entry: 'upgrade-conflict', class: 'mismatch', line: finding.record.line, message }
}

/** The line of the input that holds what stands at `offset` of the output. */
function inputLine(input: string, edits: Edit[], offset: number): number {
  return lineOf(readLines(input), offsetBefore(edits, offset))
}

function hasEntry(records: ReportRecord[], entry: string): boolean {
  return records.some((record) => record.entry === entry)
}

/** Renders both sides and adds what the comparison found to `records`. */
function selfCheck(input: string, done: Rewritten): UpgradeResult['check'] {
  const { output, records, edits } = done
  let old: string
  let next: string
  try {
    old = html01(input)
    // U-076, U-077: raw HTML passes through only under the host option, so the check sets it.
    next = html02(output, hasEntry(records, 'U-076') || hasEntry(records, 'U-077'))
  } catch (error) {
    records.push({ entry: 'upgrade-mismatch', class: 'mismatch', line: 0, message: `an engine failed: ${String(error)}` })
    return 'mismatch'
  }
  const compared = compareHtml(old, next)
  if (compared.gainedParagraphs > 0) {
    const message = `${compared.gainedParagraphs} later paragraph(s) of list items gain a paragraph element in 0.2`
    records.push({ entry: 'U-019', class: 'summary', line: 0, message })
  }
  if (compared.difference === null) return 'pass'
  const { line, expected, actual } = compared.difference
  const place = line === 0 ? 0 : inputLine(input, edits, readLines(output).starts[line - 1] ?? output.length)
  const explained = records.filter((record) => HTML_CHANGING.has(record.entry)).map((record) => record.entry)
  if (explained.length > 0) {
    const message = `the HTML differs, as the entries ${[...new Set(explained)].join(', ')} say`
    records.push({ entry: 'upgrade-difference', class: 'summary', line: place, message })
    return 'explained'
  }
  const message = `the HTML differs: 0.1 gives ${JSON.stringify(expected)}, 0.2 gives ${JSON.stringify(actual)}`
  records.push({ entry: 'upgrade-mismatch', class: 'mismatch', line: place, message })
  return 'mismatch'
}

/** Rewrites the Carve 0.1 document `input` into Carve 0.2 and checks the result against both engines. */
export function upgrade(input: string): UpgradeResult {
  const done = rewrite(input)
  const check = selfCheck(input, done)
  return { output: done.output, changed: done.output !== input, records: done.records, check, engine01: ENGINE_01_VERSION }
}

/** Whether a person has to look at the result: a report entry hit, or the self-check found a difference. */
export function needsAttention(result: UpgradeResult): boolean {
  return result.records.some(needsPerson)
}
