import { compareHtml, compareHtmlExact, dropOnlyItemParagraphs } from './compare.ts'
import { type Context, type Finding, makeContext, type Rule } from './context.ts'
import { applyEdits, type Edit, offsetBefore, selectEdits } from './edits.ts'
import { ENGINE_01_VERSION, html01, html02 } from './engines.ts'
import { needsPerson, recordOf, type ReportRecord } from './report.ts'
import { rescuePlus } from './plus-rescue.ts'
import { rescueQuote } from './quote-rescue.ts'
import { rescueFence } from './fence-rescue.ts'
import { rescueDescription } from './description-rescue.ts'
import { rescuePercent } from './percent-rescue.ts'
import { measuredReport } from './measured-reports.ts'
import { addTaskPresentation, applyHtmlTransformations, wrapLaterItemParagraphs } from './html-transform.ts'
import { rescueMinor } from './minor-rescues.ts'
import { rescueTargeted } from './targeted-rescues.ts'
import { RULES } from './rules/index.ts'
import { lineOf, lineText, readLines } from './source.ts'

export interface UpgradeResult {
  /** The Carve 0.2 source. */
  output: string
  changed: boolean
  records: ReportRecord[]
  /** Only `pass` and `explained` may clear the write gate. */
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
  const selected = selectEdits(collected)
  const rawHtml = ctx.findings.some((finding) => finding.record.entry === 'U-076' || finding.record.entry === 'U-077')
  const edits = removeNoEffectEntries(input, selected, rawHtml)
  const kept = new Set(edits)
  const accepted = new Set(selected)
  const records: ReportRecord[] = [...failures]
  for (const finding of ctx.findings) {
    if (finding.edit === null || kept.has(finding.edit)) records.push(finding.record)
    else if (!accepted.has(finding.edit)) records.push(conflict(finding))
    else if (finding.record.entry === 'U-037') records.push({ ...finding.record, class: 'none',
      message: 'brace tail kept because removing it has no HTML effect in either engine' })
  }
  const output = applyEdits(input, edits)
  if (output !== input && noHtmlEffect(input, output, records)) {
    return { output: input, records: records.filter((record) => record.class === 'report' || record.class === 'none'
      || record.entry === 'upgrade-error'), edits: [] }
  }
  return { output, records, edits }
}

function sameBothEngines(left: string, right: string, rawHtml: boolean): boolean {
  try {
    return compareHtmlExact(html01(left), html01(right)).equal
      && compareHtmlExact(html02(left, rawHtml), html02(right, rawHtml)).equal
  } catch { return false }
}

function removeNoEffectEntries(input: string, selected: Edit[], rawHtml: boolean): Edit[] {
  let kept = selected
  let output = applyEdits(input, kept)
  for (const entry of new Set(selected.map((edit) => edit.entry))) {
    const without = kept.filter((edit) => edit.entry !== entry)
    const candidate = applyEdits(input, without)
    if (!sameBothEngines(output, candidate, rawHtml)) continue
    kept = without
    output = candidate
  }
  return kept
}

function noHtmlEffect(input: string, output: string, records: ReportRecord[]): boolean {
  try {
    if (!compareHtmlExact(html01(input), html01(output)).equal) return false
    const rawHtml = hasEntry(records, 'U-076') || hasEntry(records, 'U-077')
    return compareHtmlExact(html02(input, rawHtml), html02(output, rawHtml)).equal
  } catch { return false }
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

function longerColonClose(input: string): number {
  const lines = readLines(input)
  let opener = 0
  for (let line = 1; line <= lines.count; line++) {
    let value = lineText(lines, line).trim()
    while (value.startsWith('> ')) value = value.slice(2).trimStart()
    if (value.startsWith('- ')) value = value.slice(2).trimStart()
    let run = 0
    while (value.charCodeAt(run) === 0x3a) run++
    if (run < 3 || value.length !== run) continue
    if (opener > 0 && run > opener) return line
    if (opener === 0) opener = run
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

function reportTaskHtml(old: string, next: string, records: ReportRecord[]): void {
  const changed = old.includes('<input') && next.includes('class="task"') && !old.includes('class="task"')
  if (!changed) return
  if (!hasEntry(records, 'U-133')) records.push(recordOf('U-133', 0,
    'C2-H-032 adds the task class, style, and plain-text checkbox label'))
}

function preserveLineEndings(input: string, output: string): string {
  if (!input.includes('\r\n') || input.replaceAll('\r\n', '').includes('\n')) return output
  return output.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n')
}

function addDifferenceReports(input: string, done: Rewritten, old: string, next: string,
  compared: ReturnType<typeof compareHtmlExact>, diagnose: boolean): void {
  const { records } = done
  const normalized = compareHtml(old, next)
  reportTaskHtml(old, next, records)
  if (normalized.gainedParagraphs > 0) {
    const message = `${normalized.gainedParagraphs} later paragraph(s) of list items gain a paragraph element in 0.2`
    records.push({ entry: 'U-019', class: 'summary', line: 0, message })
  }
  if (!normalized.equal && compareHtml(old, next, true).equal && !hasEntry(records, 'U-021')) {
    records.push(recordOf('U-021', 0, 'the one-item list loses its loose paragraph wrapper under C2-B-062 and C2-H-036'))
  }
  if (diagnose) recordMeasured(input, done, compared)
  const colonLine = innerColonClose(input)
  if (colonLine > 0 && !hasEntry(records, 'U-114')) {
    records.push(recordOf('U-114', colonLine,
      'after the shorter inner div closer, 0.1 opens another anonymous div and 0.2 closes the outer div'))
  }
  const longerLine = colonLine === 0 ? longerColonClose(input) : 0
  if (longerLine > 0 && !hasEntry(records, 'U-219') && colonLine === 0) {
    records.push(recordOf('U-219', longerLine,
      'C2-B-109 makes the longer bare colon run close the shorter div; no preserving 0.2 spelling was verified'))
  }
}

function applyCitedHtml(old: string, next: string, records: ReportRecord[]): ReturnType<typeof applyHtmlTransformations> {
  const transformed = applyHtmlTransformations(old, records.map((record) => record.entry))
  if (hasEntry(records, 'U-021')) {
    const without = dropOnlyItemParagraphs(transformed.html)
    if (without !== transformed.html) { transformed.html = without; transformed.applied.push('U-021') }
  }
  if (hasEntry(records, 'U-019')) {
    const wrapped = wrapLaterItemParagraphs(transformed.html, next)
    transformed.html = wrapped.html
    transformed.applied.push(...wrapped.applied)
  }
  if (hasEntry(records, 'U-133')) {
    const task = addTaskPresentation(transformed.html, next)
    transformed.html = task.html
    transformed.applied.push(...task.applied)
  }
  return transformed
}

function classifyDifference(input: string, done: Rewritten, old: string, next: string,
  compared: ReturnType<typeof compareHtmlExact>): UpgradeResult['check'] {
  const { records } = done
  const difference = compared.difference
  if (difference === null) return 'pass'
  const transformed = applyCitedHtml(old, next, records)
  if (transformed.applied.length > 0 && compareHtmlExact(transformed.html, next).equal) {
    const entries = [...new Set(transformed.applied)]
    const message = `the HTML matches after the declared transformations of ${entries.join(', ')}`
    records.push({ entry: 'upgrade-difference', class: 'summary', line: placeOf(input, done, difference.line), message })
    return 'explained'
  }
  const applied = new Set(transformed.applied)
  for (const record of records) {
    if ((record.class === 'report' || record.entry === 'U-019') && !applied.has(record.entry)) {
      record.class = 'unverified explanation'
    }
  }
  const remainder = compareHtmlExact(transformed.html, next).difference ?? difference
  const { line, expected, actual } = remainder
  const message = `the HTML differs: 0.1 gives ${JSON.stringify(expected)}, 0.2 gives ${JSON.stringify(actual)}`
  records.push({ entry: 'upgrade-mismatch', class: 'mismatch', line: placeOf(input, done, line), message })
  return 'mismatch'
}

function selfCheck(input: string, done: Rewritten, diagnose = false): UpgradeResult['check'] {
  let old: string
  let next: string
  try {
    old = html01(input)
    // U-076, U-077: raw HTML passes through only under the host option, so the check sets it.
    next = html02(done.output, hasEntry(done.records, 'U-076') || hasEntry(done.records, 'U-077'))
  } catch (error) {
    done.records.push({ entry: 'upgrade-mismatch', class: 'mismatch', line: 0,
      message: `an engine failed: ${String(error)}` })
    return 'mismatch'
  }
  const compared = compareHtmlExact(old, next)
  if (compared.difference === null) return 'pass'
  addDifferenceReports(input, done, old, next, compared, diagnose)
  return classifyDifference(input, done, old, next, compared)
}

/** The line of the input for the line `line` of the output that the comparison names. */
function placeOf(input: string, done: Rewritten, line: number): number {
  return line === 0 ? 0 : inputLine(input, done.edits, readLines(done.output).starts[line - 1] ?? done.output.length)
}

function upgradeCore(input: string): UpgradeResult {
  const done = rewrite(input)
  const rewrittenRecords = done.records.map((record) => ({ ...record }))
  let check = selfCheck(input, done)
  if (check === 'mismatch') {
    const mismatch = [...done.records].reverse().find((record) => record.entry === 'upgrade-mismatch')
    if (mismatch !== undefined) {
      const rescued = rescueFence(input, done.output, mismatch) ?? rescuePlus(input, done.output, mismatch)
        ?? rescueQuote(input, done.output, mismatch) ?? rescueDescription(input, done.output, mismatch)
        ?? rescuePercent(input, done.output, mismatch) ?? rescueTargeted(input, done.output, mismatch)
        ?? rescueMinor(input, done.output, mismatch)
      done.records = rewrittenRecords
      if (rescued !== null) {
        done.records.push(rescued.record)
        done.output = rescued.output
      }
      check = selfCheck(input, done, true)
    }
  }
  return { output: done.output, changed: done.output !== input, records: done.records, check, engine01: ENGINE_01_VERSION }
}

function normalizationPreservesHtml(input: string, normalized: string, output: string, restored: string,
  records: readonly ReportRecord[]): boolean {
  try {
    const rawHtml = records.some((record) => record.entry === 'U-076' || record.entry === 'U-077')
    return compareHtmlExact(html01(input), html01(normalized)).equal
      && compareHtmlExact(html02(output, rawHtml), html02(restored, rawHtml)).equal
  } catch { return false }
}

/** Rewrites the Carve 0.1 document `input` into Carve 0.2 and checks the result against both engines. */
export function upgrade(input: string): UpgradeResult {
  const withoutBom = input.startsWith('\ufeff') ? input.slice(1) : input
  const crlf = withoutBom.includes('\r\n') && !withoutBom.replaceAll('\r\n', '').includes('\n')
  if (withoutBom === input && !crlf) return upgradeCore(input)
  const normalized = crlf ? withoutBom.replaceAll('\r\n', '\n') : withoutBom
  const result = upgradeCore(normalized)
  const restored = crlf ? preserveLineEndings(withoutBom, result.output) : result.output
  const output = withoutBom === input ? restored : '\ufeff' + restored
  if (normalizationPreservesHtml(input, normalized, result.output, output, result.records)) {
    return { ...result, output, changed: output !== input }
  }
  result.records.push({ entry: 'upgrade-mismatch', class: 'mismatch', line: 0,
    message: 'the original and normalized BOM or line endings render differently' })
  return { ...result, output, changed: output !== input, check: 'mismatch' }
}

/** Whether a person has to look at the result: a report entry hit, or the self-check found a difference. */
export function needsAttention(result: UpgradeResult): boolean {
  return result.records.some(needsPerson)
}

export function canWriteUpgrade(result: UpgradeResult): boolean {
  return result.check === 'pass' || result.check === 'explained'
}
