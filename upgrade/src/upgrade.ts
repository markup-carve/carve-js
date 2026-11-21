import { compareHtml, compareHtmlExact, dropOnlyItemParagraphs } from './compare.ts'
import { type Context, type Finding, makeContext, type Rule } from './context.ts'
import { applyEdits, type Edit, offsetAfter, offsetBefore, selectEdits } from './edits.ts'
import { ENGINE_01_VERSION, html01, html02, type Node01 } from './engines.ts'
import { ENTRIES, needsPerson, recordOf, type ReportRecord } from './report.ts'
import { rescuePlus } from './plus-rescue.ts'
import { rescueQuote } from './quote-rescue.ts'
import { rescueFence } from './fence-rescue.ts'
import { rescueDescription } from './description-rescue.ts'
import { rescueEmptyDefinitionItem } from './definition-rescue.ts'
import { rescueCombinedInline } from './combined-inline-rescue.ts'
import { rescueBraceOpenerTags, rescueHeadingBraceTag } from './heading-brace-rescue.ts'
import { rescuePercent } from './percent-rescue.ts'
import { measuredReport, TASK_PRESENTATION_MESSAGE } from './measured-reports.ts'
import { addShortTableColumns, addTaskPresentation, followTaskLabels, applyHtmlTransformations, dropEmptyClasses, explainEmptyRuns,
  hasTaskPresentationDifference,
  moveTrailingSigilHyphen,
  wrapLaterItemParagraphs } from './html-transform.ts'
import { explainDescriptionPlusFenceEof } from './html-plus-eof.ts'
import { removeListMarkerTab } from './html-list-tab.ts'
import { removeTrailingLineBlockSpaces } from './html-line-block.ts'
import { rescueMinor } from './minor-rescues.ts'
import { rescueTargeted } from './targeted-rescues.ts'
import { rescueBacktick } from './backtick-rescue.ts'
import { rescueDirectiveSocial } from './directive-social-rescue.ts'
import { rescueBracedBoldItalic } from './bold-italic-rescue.ts'
import { rescueEscape } from './escape-rescue.ts'
import { rescueDashRun } from './dash-run-rescue.ts'
import { LATE_VARIANTS, RULES } from './rules/index.ts'
import { lineEnd, lineOf, lineStart, lineText, readLines } from './source.ts'
import { mappedRemainderReport, mappedReport, mappedRewrite, mathClassReport } from './mapped-rows.ts'
import { applyTabs, planTabs, sameHost } from './tabs.ts'
import { respellExtensions, sameExtensionHosts, type RegisteredExtension } from './extension-respell.ts'

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
  context: Context
}

/**
 * One pass: every rule reads the 0.1 tree of the input, and the edits apply together. An edit
 * that collides with one of a lower entry id is left out and named in the report.
 */
function rewrite(input: string, rules: readonly Rule[] = RULES, late = false): Rewritten {
  const ctx: Context = makeContext(input, late)
  const failures: ReportRecord[] = []
  for (const rule of rules) runRule(ctx, rule, failures)
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
  }
  const output = applyEdits(input, edits)
  if (output !== input && !edits.some((edit) => edit.diagnosed === true) && noHtmlEffect(input, output, records)) {
    return { output: input, records: records.filter((record) => record.class === 'report' || record.class === 'none'
      || record.entry === 'upgrade-error'), edits: [], context: ctx }
  }
  return { output, records, edits, context: ctx }
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

function reportShortTableWidths(done: Rewritten, old: string, next: string): void {
  if (!old.includes('<colgroup>') || !next.includes('<colgroup>')) return
  for (const { node } of done.context.visits) {
    if (node.type !== 'table' || node.pos === undefined) continue
    const widths = (node.attrs as { keyValues?: { widths?: string } } | undefined)?.keyValues?.widths
    const columns = node.columns as unknown[] | undefined
    const rows = node.rows as { cells?: unknown[] }[] | undefined
    if (widths === undefined || columns === undefined || rows?.[0]?.cells === undefined
      || columns.length >= rows[0].cells.length) continue
    const line = node.pos.startLine - 1
    if (line < 1) continue
    const range = { startOffset: lineStart(done.context.lines, line), endOffset: lineEnd(done.context.lines, line) }
    done.records.push({ ...recordOf('U-150', line, 'the short table column list gains an empty column element in 0.2'), range })
  }
}

function reportEmptyClass(done: Rewritten, old: string): void {
  if (!old.includes(' class="')) return
  for (const { node } of done.context.visits) {
    if (node.pos === undefined) continue
    const classes = (node.attrs as { classes?: unknown[] } | undefined)?.classes
    if (!classes?.some((value) => typeof value === 'string' && /^[ \t]*$/u.test(value))) continue
    const previous = node.pos.startLine - 1
    const ownText = done.context.src.slice(node.pos.startOffset, node.pos.endOffset)
    const metadata = !ownText.includes('class=') && previous > 0
      && lineText(done.context.lines, previous).includes('class=')
    const line = metadata ? previous : node.pos.startLine
    const range = metadata ? { startOffset: lineStart(done.context.lines, line), endOffset: lineEnd(done.context.lines, line) }
      : { startOffset: node.pos.startOffset, endOffset: node.pos.endOffset }
    done.records.push({ ...recordOf('U-282', line, 'the empty class token is omitted by 0.2'), range })
  }
}

function editorialCloser(type: string): string | null {
  if (type === 'delete') return '-}'
  if (type === 'insert') return '+}'
  if (type === 'underline') return '_}'
  if (type === 'substitution') return '~}'
  return null
}

function editorialChildren(node: Node01): Node01[] {
  const children = node.children ?? []
  const old = Array.isArray(node.old) ? node.old as Node01[] : []
  const next = Array.isArray(node.new) ? node.new as Node01[] : []
  return [...children, ...old, ...next]
}

function nestedEditorialCloser(children: Node01[]): boolean {
  const stack = [...children]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.type === 'text' && typeof node.value === 'string' && /[-+_~]\}/u.test(node.value)) return true
    if (node.type === 'code' || node.type === 'code_block' || node.type === 'raw_inline'
      || node.type === 'raw_block' || node.type === 'comment' || node.type === 'literal_inline') continue
    stack.push(...editorialChildren(node))
  }
  return false
}

function reportNestedEditorial(done: Rewritten): void {
  for (const { node } of done.context.visits) {
    if (node.pos === undefined) continue
    const closer = editorialCloser(node.type)
    if (closer === null) continue
    const { startOffset: start, endOffset: end, startLine: line } = node.pos
    const children = editorialChildren(node)
    const nested = children.some((child) => editorialCloser(child.type) !== null
      || child.type === 'text' && typeof child.value === 'string' && /\{[-+_~]/u.test(child.value))
    if (!nested) continue
    const innerCloser = nestedEditorialCloser(children)
    const tail = done.context.src.slice(end, lineEnd(done.context.lines, node.pos.endLine))
    if (!innerCloser && !tail.includes(closer)) continue
    done.records.push({ ...recordOf('U-374', line, 'nested editorial closers pair differently in 0.2'),
      range: { startOffset: start, endOffset: end } })
  }
}

function reportShortItemComment(done: Rewritten): void {
  for (const visit of done.context.visits) {
    const node = visit.node
    const item = visit.parent
    if (node.type !== 'comment' || node.pos === undefined || item?.node.type !== 'list_item'
      || item.node.pos === undefined || item.index + 1 >= item.siblings.length) continue
    const before = visit.siblings[visit.index - 1]
    if (before?.pos === undefined || node.pos.startLine < before.pos.endLine + 2
      || node.pos.startColumn >= item.node.pos.startColumn + 2) continue
    done.records.push({ ...recordOf('U-362', node.pos.startLine,
      'the short comment line after a blank changes list item ownership in 0.2'),
    range: { startOffset: node.pos.startOffset, endOffset: node.pos.endOffset } })
  }
}

function reportTrailingSigil(done: Rewritten): void {
  for (const { node } of done.context.visits) {
    if (node.pos === undefined) continue
    const name = node.type === 'tag' ? node.name : node.type === 'mention' ? node.user : undefined
    if (typeof name !== 'string' || !name.endsWith('-')) continue
    const range = { startOffset: node.pos.startOffset, endOffset: node.pos.endOffset }
    const existing = done.records.find((record) => record.entry === 'U-170' && record.range === undefined)
    if (existing !== undefined) existing.range = range
    else done.records.push({ ...recordOf('U-170', node.pos.startLine, 'a trailing sigil hyphen becomes text in 0.2'), range })
  }
}

function addDifferenceReports(input: string, done: Rewritten, old: string, next: string): void {
  const { records } = done
  reportShortTableWidths(done, old, next)
  reportEmptyClass(done, old)
  reportNestedEditorial(done)
  reportShortItemComment(done)
  reportTrailingSigil(done)
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
      const label = followTaskLabels(task.html, next)
      transformed.html = label.html
      transformed.applied.push(...task.applied, ...label.applied)
    }
  }
  const catalog = applyHtmlTransformations(transformed.html, next,
    entries.filter((entry) => entry !== 'U-154' && entry !== 'U-133' && entry !== 'U-159'))
  transformed.html = catalog.html
  transformed.applied.push(...catalog.applied)
  if (records.some((record) => record.entry === 'U-150' && record.range !== undefined)) {
    const columns = addShortTableColumns(transformed.html, next)
    transformed.html = columns.html
    transformed.applied.push(...columns.applied)
  }
  if (records.some((record) => record.entry === 'U-282' && record.range !== undefined)) {
    const classes = dropEmptyClasses(transformed.html, next)
    transformed.html = classes.html
    transformed.applied.push(...classes.applied)
  }
  if (records.some((record) => record.entry === 'U-170' && record.range !== undefined)) {
    const sigil = moveTrailingSigilHyphen(transformed.html, next)
    transformed.html = sigil.html
    transformed.applied.push(...sigil.applied)
  }
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
    const report = measuredReport(done.context, remainder.expected, remainder.actual,
      placeOf(input, done, remainder.line), transformed.applied.length > 0)
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
  const empty = done.records.filter((record) => (record.entry === 'U-258' || record.entry === 'U-396')
    && record.class === 'report' && record.range !== undefined)
    .map((record) => input.slice(record.range!.startOffset, record.range!.endOffset))
  const runs = explainEmptyRuns(cited.html, empty, next)
  const eof = explainDescriptionPlusFenceEof(input, done.output, runs.html, next)
  const tab = hasEntry(done.records, 'U-153') ? removeListMarkerTab(input, eof.html, next)
    : { html: eof.html, applied: [] }
  const line = hasEntry(done.records, 'U-130') ? removeTrailingLineBlockSpaces(input, tab.html, next)
    : { html: tab.html, applied: [] }
  return { html: line.html, applied: [...cited.applied, ...runs.applied, ...eof.applied, ...tab.applied, ...line.applied] }
}

function markUnusedReports(records: ReportRecord[], applied: Set<string>): void {
  for (const record of records) {
    if ((record.class === 'report' || record.entry === 'U-019') && record.range === undefined && !applied.has(record.entry)) {
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
  const sourceLine = placeOf(input, done, line)
  const mappedRemainder = mappedRemainderReport(input, old, next, sourceLine)
  if (mappedRemainder !== null && !hasEntry(records, mappedRemainder.entry)) records.push(mappedRemainder)
  const source = readLines(input)
  const citedRange = records.find((record) => record.entry === 'U-130' && record.range !== undefined)?.range
  const range = citedRange ?? (sourceLine === 0 ? { startOffset: 0, endOffset: input.length }
    : { startOffset: lineStart(source, sourceLine), endOffset: lineEnd(source, sourceLine) })
  const rows = [...new Set(records.filter((record) => /^U-\d+$/u.test(record.entry)).map((record) => record.entry))]
  const owner = rows.length === 0 ? 'no mapped row' : `mapped row ${rows.join(', ')}`
  const message = `${owner}: the HTML still differs after cited transformations: `
    + `left ${JSON.stringify(expected)}, 0.2 ${JSON.stringify(actual)}`
  records.push({ entry: 'upgrade-mismatch', class: 'mismatch', line: sourceLine, range, message,
    ...(rows.length === 0 ? { status: 'no mapped row' as const } : {}) })
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
function rescueMismatch(input: string, output: string, mismatch: ReportRecord, records: readonly ReportRecord[],
  outputLine = 0): { output: string; record: ReportRecord } | null {
  // U-430 and U-431 leave a line that only report rows cite to a person (carve#6163).
  const onLine = records.filter((record) => record.line === mismatch.line || record.line === 0)
  const reported = onLine.some((record) => record.class === 'report' || record.class === 'unverified explanation')
    && !onLine.some((record) => record.class === 'rewrite' || record.class === 'escape')
  const rescues = [rescueFence, rescuePlus, rescueQuote, rescueEmptyDefinitionItem, rescueDescription, rescuePercent,
    rescueCombinedInline, rescueHeadingBraceTag, rescueTargeted, rescueMinor, rescueBacktick, rescueDirectiveSocial, rescueBraceOpenerTags,
    rescueBracedBoldItalic, ...(reported ? [] : [rescueEscape, rescueDashRun])]
  for (const rescue of rescues) {
    const rescued = rescue(input, output, mismatch)
    if (rescued !== null) return rescued
  }
  // The repairs also read the line of the output that holds the mismatch line of the input.
  return outputLine > 0 && outputLine !== mismatch.line && !reported ? rescueEscape(input, output, mismatch, outputLine) : null
}

function preservingMappedResult(input: string, mapped: { output: string; record: ReportRecord }): UpgradeResult {
  // A preserving spelling still needs every independent report found in the original source.
  const done = rewrite(input)
  const records = done.records.filter((record) => record.class === 'report' || record.class === 'none'
    || record.entry === 'upgrade-error')
  const mathClass = mathClassReport(done.context)
  if (mathClass !== null && !hasEntry(records, 'U-249')) records.push(mathClass)
  return { output: mapped.output, changed: mapped.output !== input, records: [mapped.record, ...records],
    check: 'pass', engine01: ENGINE_01_VERSION }
}

/** U-290 keeps the directive unexpanded, so the U-011 review of the failed check stays. */
function keepIncludeReview(rescue: ReportRecord, checked: readonly ReportRecord[], records: ReportRecord[]): void {
  if (rescue.entry !== 'U-290' || hasEntry(records, 'U-011')) return
  for (const record of checked) if (record.entry === 'U-011') records.push({ ...record, class: 'report' })
}

/** The line of the output of a repairs variant that holds the mismatch line of the input, else 0. */
function repairsLine(input: string, done: Rewritten, mismatch: ReportRecord): number {
  if (done.context.repairs !== true || mismatch.line < 1) return 0
  const at = offsetAfter(done.edits, lineStart(readLines(input), mismatch.line))
  return lineOf(readLines(done.output), at)
}

/** A repairs variant that writes an output already tried still gets its own rescues. */
function triedBefore(tried: Set<string>, done: Rewritten): boolean {
  return tried.has(done.output) && done.context.repairs !== true
}

/** The first late variant whose output clears the self-check. */
function latePass(input: string, first: string): UpgradeResult | null {
  const tried = new Set([first])
  for (const rules of LATE_VARIANTS) {
    const done = rewrite(input, rules, true)
    if (triedBefore(tried, done)) continue
    tried.add(done.output)
    const mathClass = mathClassReport(done.context)
    if (mathClass !== null && !hasEntry(done.records, 'U-249')) done.records.push(mathClass)
    const rewritten = done.records.map((record) => ({ ...record }))
    let check = selfCheck(input, done)
    const mismatch = [...done.records].reverse().find((record) => record.entry === 'upgrade-mismatch')
    if (check === 'mismatch' && mismatch !== undefined) {
      const rescued = rescueMismatch(input, done.output, mismatch, done.records, repairsLine(input, done, mismatch))
      if (rescued !== null && !tried.has(rescued.output)) {
        tried.add(rescued.output)
        done.records = [...recordsAfterRescue(input, rescued, rewritten), rescued.record]
        done.output = rescued.output
        check = selfCheck(input, done)
      }
    }
    if (check !== 'mismatch') {
      return { output: done.output, changed: done.output !== input, records: done.records, check, engine01: ENGINE_01_VERSION }
    }
  }
  return null
}

function upgradeSource(input: string): UpgradeResult {
  const mapped = mappedRewrite(input)
  if (mapped !== null) return preservingMappedResult(input, mapped)
  const manual = mappedReport(input)
  if (manual.length > 0) {
    const done: Rewritten = { output: input, records: manual, edits: [], context: makeContext(input) }
    const check = selfCheck(input, done)
    return { output: input, changed: false, records: done.records, check, engine01: ENGINE_01_VERSION }
  }
  const { done, check } = firstPass(input)
  if (check === 'mismatch') {
    const late = latePass(input, done.output)
    if (late !== null) return late
  }
  return { output: done.output, changed: done.output !== input, records: done.records, check, engine01: ENGINE_01_VERSION }
}

/** The rules, then the first rescue whose spelling keeps the 0.1 HTML. */
function firstPass(input: string): { done: Rewritten; check: UpgradeResult['check'] } {
  const done = rewrite(input)
  const mathClass = mathClassReport(done.context)
  if (mathClass !== null && !hasEntry(done.records, 'U-249')) done.records.push(mathClass)
  const rewrittenRecords = done.records.map((record) => ({ ...record }))
  const check = selfCheck(input, done)
  const mismatch = [...done.records].reverse().find((record) => record.entry === 'upgrade-mismatch')
  if (check !== 'mismatch' || mismatch === undefined) return { done, check }
  const rescued = rescueMismatch(input, done.output, mismatch, done.records)
  const checked = done.records
  done.records = rescued === null ? rewrittenRecords : recordsAfterRescue(input, rescued, rewrittenRecords)
  if (rescued !== null) {
    keepIncludeReview(rescued.record, checked, done.records)
    done.records.push(rescued.record)
    done.output = rescued.output
  }
  return { done, check: selfCheck(input, done) }
}

/** A record of the text after `edits`, placed in the text before them. */
function beforeEdits(input: string, edits: Edit[], record: ReportRecord): ReportRecord {
  const output = applyEdits(input, edits)
  const at = record.line === 0 ? 0 : offsetBefore(edits, lineStart(readLines(output), record.line))
  const moved = { ...record, line: record.line === 0 ? 0 : lineOf(readLines(input), at) }
  if (record.range === undefined) return moved
  return { ...moved, range: { startOffset: offsetBefore(edits, record.range.startOffset),
    endOffset: offsetBefore(edits, record.range.endOffset) } }
}

function unmappedTabs(records: ReportRecord[]): boolean {
  return records.some((record) => record.class === 'mismatch')
}

/** The tabs pass places its own records, so an exact catalog report of the same row is left out. */
function withTabRecords(tabRecords: ReportRecord[], records: ReportRecord[]): ReportRecord[] {
  const own = new Set(tabRecords.map((record) => record.entry))
  return [...tabRecords, ...records.filter((record) => !own.has(record.entry))]
}

/**
 * U-412, U-413: the tab openers are rewritten first, so the default-render check reads the 0.1 meaning of
 * the rewritten source; the tabs hosts of both engines then confirm the original groups.
 */
function upgradeCore(input: string): UpgradeResult {
  const classTabs = mappedRewrite(input)
  if (classTabs?.record.entry === 'U-427') return preservingMappedResult(input, classTabs)
  const plan = planTabs(input)
  if (plan.edits.length === 0 && plan.records.length === 0) return upgradeSource(input)
  const plain = (): UpgradeResult => {
    const result = upgradeSource(input)
    const kept = plan.edits.length === 0 ? plan.records : planTabs(input, false).records
    return { ...result, records: withTabRecords(kept, result.records),
      check: unmappedTabs(kept) ? 'mismatch' : result.check }
  }
  if (plan.edits.length === 0) return plain()
  const result = upgradeSource(applyTabs(input, plan))
  if (!sameHost(input, result.output)) return plain()
  if (result.check === 'mismatch') {
    const fallback = plain()
    if (fallback.check !== 'mismatch') return fallback
  }
  const records = withTabRecords([...plan.rewrites, ...plan.records],
    result.records.map((record) => beforeEdits(input, plan.edits, record)))
  const check = result.check === 'mismatch' || unmappedTabs(plan.records) ? 'mismatch' : 'explained'
  if (check === 'explained') {
    const entries = [...new Set(plan.rewrites.map((record) => record.entry))].join(', ')
    records.push({ entry: 'upgrade-difference', class: 'summary', line: 0,
      message: `the tabs groups match under the tabs hosts of both engines after ${entries}` })
  }
  return { ...result, records, changed: result.output !== input, check }
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
function upgradeBase(input: string): UpgradeResult {
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

/** Rewrite only source forms of the 0.1 host extensions the caller explicitly registered. */
export function upgrade(input: string, registered: readonly RegisteredExtension[] = []): UpgradeResult {
  const base = upgradeBase(input)
  if (registered.length === 0) return base
  const planned = respellExtensions(base.output, registered)
  if (planned.records.length === 0) return base
  const verified = base.check !== 'mismatch' && sameExtensionHosts(input, planned.output, registered)
  const records = [...base.records, ...planned.records]
  if (!verified) records.push({ entry: 'upgrade-mismatch', class: 'mismatch', line: 0,
    message: 'the registered 0.1 extension host and the 0.2 standard host render differently' })
  return { ...base, output: planned.output, changed: planned.output !== input, records,
    check: verified ? 'explained' : 'mismatch' }
}

/** Whether a person has to look at the result: a report entry hit, or the self-check found a difference. */
export function needsAttention(result: UpgradeResult): boolean {
  return result.records.some(needsPerson)
}

export function canWriteUpgrade(result: UpgradeResult): boolean {
  return result.check === 'pass' || result.check === 'explained'
}
