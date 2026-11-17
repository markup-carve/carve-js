import { compareHtml, compareHtmlExact, dropOnlyItemParagraphs } from './compare.ts'
import { type Context, type Finding, makeContext, type Rule } from './context.ts'
import { applyEdits, type Edit, offsetBefore, selectEdits } from './edits.ts'
import { ENGINE_01_VERSION, html01, html02 } from './engines.ts'
import { ENTRIES, needsPerson, recordOf, type ReportRecord } from './report.ts'
import { rescuePlus } from './plus-rescue.ts'
import { rescueQuote } from './quote-rescue.ts'
import { rescueFence } from './fence-rescue.ts'
import { rescueDescription } from './description-rescue.ts'
import { rescueEmptyDefinitionItem } from './definition-rescue.ts'
import { rescueCombinedInline } from './combined-inline-rescue.ts'
import { rescueHeadingBraceTag } from './heading-brace-rescue.ts'
import { rescuePercent } from './percent-rescue.ts'
import { measuredReport, TASK_PRESENTATION_MESSAGE } from './measured-reports.ts'
import { addTaskPresentation, applyHtmlTransformations, hasTaskPresentationDifference,
  wrapLaterItemParagraphs } from './html-transform.ts'
import { explainDescriptionPlusFenceEof } from './html-plus-eof.ts'
import { removeListMarkerTab } from './html-list-tab.ts'
import { removeTrailingLineBlockSpaces } from './html-line-block.ts'
import { rescueMinor } from './minor-rescues.ts'
import { rescueTargeted } from './targeted-rescues.ts'
import { rescueBacktick } from './backtick-rescue.ts'
import { RULES } from './rules/index.ts'
import { lineOf, lineText, readLines } from './source.ts'
import { mappedRewrite } from './mapped-rows.ts'

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
  if (output !== input && !edits.some((edit) => edit.diagnosed === true) && noHtmlEffect(input, output, records)) {
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
    if (selected.some((edit) => edit.entry === entry && edit.diagnosed === true)) continue
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

function reportTaskHtml(old: string, next: string, records: ReportRecord[]): void {
  const changed = old.includes('<input') && hasTaskPresentationDifference(old, next)
  if (!changed) return
  if (!hasEntry(records, 'U-133')) records.push(recordOf('U-133', 0, TASK_PRESENTATION_MESSAGE))
}

function preserveLineEndings(input: string, output: string): string {
  if (!input.includes('\r\n') || input.replaceAll('\r\n', '').includes('\n')) return output
  return output.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n')
}

function addDifferenceReports(input: string, done: Rewritten, old: string, next: string): void {
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

function applyCitedStep(old: string, next: string, records: ReportRecord[]): ReturnType<typeof applyHtmlTransformations> {
  const entries = records.map((record) => record.entry)
  const transformed: ReturnType<typeof applyHtmlTransformations> = { html: old, applied: [] }
  if (hasEntry(records, 'U-019')) {
    const wrapped = wrapLaterItemParagraphs(transformed.html, next)
    transformed.html = wrapped.html
    transformed.applied.push(...wrapped.applied)
  }
  if (hasEntry(records, 'U-133') || hasEntry(records, 'U-159')) {
    const labels = applyHtmlTransformations(transformed.html, next,
      entries.filter((entry) => entry === 'U-133' || entry === 'U-159'))
    transformed.html = labels.html
    transformed.applied.push(...labels.applied)
    if (hasEntry(records, 'U-133')) {
      const task = addTaskPresentation(transformed.html, next)
      transformed.html = task.html
      transformed.applied.push(...task.applied)
    }
  }
  const catalog = applyHtmlTransformations(transformed.html, next,
    entries.filter((entry) => entry !== 'U-154' && entry !== 'U-133' && entry !== 'U-159'))
  transformed.html = catalog.html
  transformed.applied.push(...catalog.applied)
  return transformed
}

function applyCitedHtml(old: string, next: string, records: ReportRecord[]): ReturnType<typeof applyHtmlTransformations> {
  const transformed = applyHtmlTransformations(old, next, hasEntry(records, 'U-154') ? ['U-154'] : [])
  if (hasEntry(records, 'U-021')) {
    const without = dropOnlyItemParagraphs(transformed.html)
    if (without !== transformed.html) { transformed.html = without; transformed.applied.push('U-021') }
  }
  const seen = new Set<string>()
  while (!seen.has(transformed.html)) {
    seen.add(transformed.html)
    const step = applyCitedStep(transformed.html, next, records)
    if (step.html === transformed.html) break
    transformed.html = step.html
    transformed.applied.push(...step.applied)
  }
  return transformed
}

function transformWithRemainderReports(input: string, done: Rewritten, old: string, next: string):
  ReturnType<typeof applyHtmlTransformations> {
  let transformed = applyExtraHtml(input, done, old, next)
  for (let attempt = 0; attempt < ENTRIES.length; attempt++) {
    const remainder = compareHtmlExact(transformed.html, next).difference
    if (remainder === null) break
    const report = measuredReport(input, remainder.expected, remainder.actual, placeOf(input, done, remainder.line),
      transformed.applied.length > 0)
    if (report === null || hasEntry(done.records, report.entry)) break
    done.records.push(report)
    const nextTransform = applyExtraHtml(input, done, old, next)
    if (nextTransform.html === transformed.html) break
    transformed = nextTransform
  }
  return transformed
}

function applyExtraHtml(input: string, done: Rewritten, old: string, next: string):
  ReturnType<typeof applyHtmlTransformations> {
  const cited = applyCitedHtml(old, next, done.records)
  const eof = explainDescriptionPlusFenceEof(input, done.output, cited.html, next)
  const tab = hasEntry(done.records, 'U-153') ? removeListMarkerTab(input, eof.html, next)
    : { html: eof.html, applied: [] }
  const line = hasEntry(done.records, 'U-130') ? removeTrailingLineBlockSpaces(input, tab.html, next)
    : { html: tab.html, applied: [] }
  return { html: line.html, applied: [...cited.applied, ...eof.applied, ...tab.applied, ...line.applied] }
}

function markUnusedReports(records: ReportRecord[], applied: Set<string>): void {
  for (const record of records) {
    if ((record.class === 'report' || record.entry === 'U-019') && !applied.has(record.entry)) {
      record.class = 'unverified explanation'
    }
  }
}

function classifyDifference(input: string, done: Rewritten, old: string, next: string,
  compared: ReturnType<typeof compareHtmlExact>): UpgradeResult['check'] {
  const { records } = done
  const difference = compared.difference
  if (difference === null) return 'pass'
  const transformed = transformWithRemainderReports(input, done, old, next)
  const equal = compareHtmlExact(transformed.html, next).equal
  if (transformed.applied.length > 0 && equal) {
    if (transformed.applied.includes('U-204') && !hasEntry(records, 'U-204')) {
      records.push({ ...recordOf('U-204', placeOf(input, done, difference.line),
        'C2-B-222 adds a final line feed to an unclosed code fence after the continuation rewrite'), class: 'report' })
    }
    const entries = [...new Set(transformed.applied)]
    const message = `the HTML matches after the declared transformations of ${entries.join(', ')}`
    records.push({ entry: 'upgrade-difference', class: 'summary', line: placeOf(input, done, difference.line), message })
    return 'explained'
  }
  markUnusedReports(records, new Set(transformed.applied))
  const remainder = compareHtmlExact(transformed.html, next).difference ?? difference
  const { line, expected, actual } = remainder
  const message = `the HTML still differs after cited transformations: left ${JSON.stringify(expected)}, 0.2 ${JSON.stringify(actual)}`
  records.push({ entry: 'upgrade-mismatch', class: 'mismatch', line: placeOf(input, done, line), message })
  return 'mismatch'
}

function selfCheck(input: string, done: Rewritten): UpgradeResult['check'] {
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
  addDifferenceReports(input, done, old, next)
  return classifyDifference(input, done, old, next, compared)
}

/** The line of the input for the line `line` of the output that the comparison names. */
function placeOf(input: string, done: Rewritten, line: number): number {
  return line === 0 ? 0 : inputLine(input, done.edits, readLines(done.output).starts[line - 1] ?? done.output.length)
}

function recordsAfterRescue(input: string, rescued: { output: string; record: ReportRecord },
  records: ReportRecord[]): ReportRecord[] {
  if (rescued.record.entry === 'U-145' && rescued.output === input.replaceAll('/***/', '{*{/*/}*}')) {
    return records.filter((record) => record.entry !== 'U-068')
  }
  const lines = input.trimEnd().split('\n')
  if (rescued.record.entry === 'U-125' && lines.length === 3 && lines[0] === '>' && lines[1] === '+') {
    return records.filter((record) => record.entry !== 'U-014')
  }
  return records
}

/** The first rescue whose spelling keeps the 0.1 HTML, in the order of the rescues. */
function rescueMismatch(input: string, output: string, mismatch: ReportRecord): { output: string; record: ReportRecord } | null {
  const rescues = [rescueFence, rescuePlus, rescueQuote, rescueEmptyDefinitionItem, rescueDescription, rescuePercent,
    rescueCombinedInline, rescueHeadingBraceTag, rescueTargeted, rescueMinor, rescueBacktick]
  for (const rescue of rescues) {
    const rescued = rescue(input, output, mismatch)
    if (rescued !== null) return rescued
  }
  return null
}

function upgradeCore(input: string): UpgradeResult {
  const mapped = mappedRewrite(input)
  if (mapped !== null) return { output: mapped.output, changed: true, records: [mapped.record],
    check: 'pass', engine01: ENGINE_01_VERSION }
  const done = rewrite(input)
  const rewrittenRecords = done.records.map((record) => ({ ...record }))
  let check = selfCheck(input, done)
  if (check === 'mismatch') {
    const mismatch = [...done.records].reverse().find((record) => record.entry === 'upgrade-mismatch')
    if (mismatch !== undefined) {
      const rescued = rescueMismatch(input, done.output, mismatch)
      done.records = rescued === null ? rewrittenRecords : recordsAfterRescue(input, rescued, rewrittenRecords)
      if (rescued !== null) {
        done.records.push(rescued.record)
        done.output = rescued.output
      }
      check = selfCheck(input, done)
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
