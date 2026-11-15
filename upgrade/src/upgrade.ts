import { compareHtml } from './compare.ts'
import { type Context, type Finding, makeContext, type Rule } from './context.ts'
import { applyEdits, type Edit, offsetBefore, selectEdits } from './edits.ts'
import { ENGINE_01_VERSION, html01, html02 } from './engines.ts'
import { needsPerson, recordOf, type ReportRecord } from './report.ts'
import { rescuePlus } from './plus-rescue.ts'
import { rescueQuote } from './quote-rescue.ts'
import { rescueFence } from './fence-rescue.ts'
import { rescueDescription } from './description-rescue.ts'
import { rescuePercent } from './percent-rescue.ts'
import { MEASURED_REPORT_IDS, measuredReport } from './measured-reports.ts'
import { rescueMinor } from './minor-rescues.ts'
import { rescueTargeted } from './targeted-rescues.ts'
import { RULES } from './rules/index.ts'
import { lineOf, lineText, readLines } from './source.ts'

/** Report entries after which the HTML of 0.2 differs from the HTML of 0.1 by the contract. */
const HTML_CHANGING = new Set(['U-011', 'U-059', 'U-060', 'U-061', 'U-072', 'U-073', 'U-076', 'U-077',
  'U-130', 'U-131', 'U-132', 'U-133', 'U-134', 'U-140', 'U-198'])

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

/** U-114: a shorter bare colon run closes an inner div before the outer div's own closer. */
function innerColonClose(input: string): number {
  const lines = readLines(input)
  let outer = 0
  for (let line = 1; line <= lines.count; line++) {
    const value = lineText(lines, line).trim()
    let run = 0
    while (value.charCodeAt(run) === 0x3a) run++
    if (run >= 4 && value.length > run && outer === 0) outer = run
    else if (outer > run && run >= 3 && value.length === run && line < lines.count) {
      const next = lineText(lines, line + 1).trim()
      if (next !== '' && !next.startsWith(':')) return line
    }
  }
  return 0
}

function recordMeasured(input: string, done: Rewritten, comparison: ReturnType<typeof compareHtml>): void {
  const difference = comparison.difference
  if (difference === null) return
  const { expected, actual, line } = difference
  const place = placeOf(input, done, line)
  const measured = measuredReport(input, expected, actual, place)
  if (measured !== null && !hasEntry(done.records, measured.entry)) done.records.push(measured)
}

function oneItemComparison(old: string, next: string, records: ReportRecord[], strict: ReturnType<typeof compareHtml>):
  { comparison: ReturnType<typeof compareHtml>, explained: boolean } {
  const normalized = compareHtml(old, next, true)
  const wrapperLost = normalized.difference === null && strict.difference?.expected.includes('<p>') === true
  const explained = hasEntry(records, 'U-021') || wrapperLost
  if (explained && !hasEntry(records, 'U-021')) records.push(recordOf('U-021', 0,
    'the one-item list loses the loose paragraph wrapper under C2-B-062 and C2-H-036'))
  return { comparison: explained ? normalized : strict, explained }
}

function reportTaskHtml(input: string, old: string, next: string, records: ReportRecord[],
  strict: ReturnType<typeof compareHtml>): boolean {
  if (strict.difference !== null) return false
  const changed = old.includes('<input') && next.includes('class="task"') && !old.includes('class="task"')
  if (!changed || records.length > 0 && input.trimEnd() !== '- [ ] +') return false
  if (!hasEntry(records, 'U-133')) records.push(recordOf('U-133', 0,
    'C2-H-032 adds the task class, style, and plain-text checkbox label'))
  return true
}

/** Renders both sides and adds what the comparison found to `records`. */
function selfCheck(input: string, done: Rewritten, diagnose = false): UpgradeResult['check'] {
  const { output, records } = done
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
  const strict = compareHtml(old, next)
  const taskReport = reportTaskHtml(input, old, next, records, strict)
  if (strict.gainedParagraphs > 0) {
    const message = `${strict.gainedParagraphs} later paragraph(s) of list items gain a paragraph element in 0.2`
    records.push({ entry: 'U-019', class: 'summary', line: 0, message })
  }
  if (strict.difference === null) return taskReport ? 'explained' : 'pass'
  // U-021: a list of one item is tight in 0.2, so its paragraph elements are left out of a second comparison.
  const { comparison: compared, explained: oneItem } = oneItemComparison(old, next, records, strict)
  if (diagnose) recordMeasured(input, done, compared)
  const explained = records.filter((record) => HTML_CHANGING.has(record.entry)
    || MEASURED_REPORT_IDS.includes(record.entry)).map((record) => record.entry)
  if (oneItem) explained.unshift('U-021')
  if (compared.difference === null || explained.length > (oneItem ? 1 : 0)) {
    const line = compared.difference === null ? strict.difference.line : compared.difference.line
    const message = `the HTML differs, as the entries ${[...new Set(explained)].join(', ')} say`
    records.push({ entry: 'upgrade-difference', class: 'summary', line: placeOf(input, done, line), message })
    return 'explained'
  }
  const colonLine = innerColonClose(input)
  if (colonLine > 0) {
    records.push(recordOf('U-114', colonLine,
      'after the shorter inner div closer, 0.1 opens another anonymous div and 0.2 closes the outer div'))
    records.push({ entry: 'upgrade-difference', class: 'summary', line: colonLine,
      message: 'the HTML differs, as U-114 says' })
    return 'explained'
  }
  const { line, expected, actual } = compared.difference
  const message = `the HTML differs: 0.1 gives ${JSON.stringify(expected)}, 0.2 gives ${JSON.stringify(actual)}`
  records.push({ entry: 'upgrade-mismatch', class: 'mismatch', line: placeOf(input, done, line), message })
  return 'mismatch'
}

/** The line of the input for the line `line` of the output that the comparison names. */
function placeOf(input: string, done: Rewritten, line: number): number {
  return line === 0 ? 0 : inputLine(input, done.edits, readLines(done.output).starts[line - 1] ?? done.output.length)
}

/** Rewrites the Carve 0.1 document `input` into Carve 0.2 and checks the result against both engines. */
export function upgrade(input: string): UpgradeResult {
  const done = rewrite(input)
  let check = selfCheck(input, done)
  if (check === 'mismatch') {
    const mismatch = [...done.records].reverse().find((record) => record.entry === 'upgrade-mismatch')
    if (mismatch !== undefined) {
      const rescued = rescueFence(input, done.output, mismatch) ?? rescuePlus(input, done.output, mismatch)
        ?? rescueQuote(input, done.output, mismatch) ?? rescueDescription(input, done.output, mismatch)
        ?? rescuePercent(input, done.output, mismatch) ?? rescueTargeted(input, done.output, mismatch)
        ?? rescueMinor(input, done.output, mismatch)
      done.records = done.records.filter((record) => record.entry !== 'upgrade-mismatch' && record.entry !== 'U-019')
      if (rescued !== null) {
        done.records.push(rescued.record)
        done.output = rescued.output
      }
      check = selfCheck(input, done, true)
    }
  }
  return { output: done.output, changed: done.output !== input, records: done.records, check, engine01: ENGINE_01_VERSION }
}

/** Whether a person has to look at the result: a report entry hit, or the self-check found a difference. */
export function needsAttention(result: UpgradeResult): boolean {
  return result.records.some(needsPerson)
}
