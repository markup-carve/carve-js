import { recordOf, type ReportRecord } from './report.ts'
import measuredExamples from '../data/measured-reports.json' with { type: 'json' }
import transformations from '../data/html-transformations.json' with { type: 'json' }
import { matchMeasured } from './measured-matchers.ts'
import { type Context } from './context.ts'

export const MEASURED_REPORT_IDS: readonly string[] = measuredExamples.map((item) => item.id)
export const TASK_PRESENTATION_MESSAGE =
  'C2-H-032 adds the task class and generated list style; the checkbox label follows 0.2 plain text'

export function exactMeasuredReport(input: string, line: number): ReportRecord | null {
  const example = measuredExamples.find((item) => item.input === input)
  return example === undefined ? null : recordOf(example.id, line, example.message)
}

function catalogDifference(expected: string, actual: string, line: number): ReportRecord | null {
  for (const change of transformations) {
    const before = change.before.join('')
    const after = change.after.join('')
    if (before.length === 0 || after.length === 0 || !expected.includes(before) || !actual.includes(after)) continue
    const example = measuredExamples.find((item) => item.id === change.id)
    if (example !== undefined) return recordOf(example.id, line, example.message)
  }
  return null
}

function remainderCatalog(expected: string, actual: string, line: number, remainder: boolean): ReportRecord | null {
  return remainder ? catalogDifference(expected, actual, line) : null
}

function hasDefinitionLine(input: string, prefix: string, includeFootnote = false): boolean {
  for (const line of input.split('\n')) {
    const value = line.trimStart()
    if (!value.startsWith(prefix)) continue
    const open = value.indexOf('[')
    const close = value.indexOf(']:', open + 1)
    if (open >= 0 && close > open + 1 && (includeFootnote || value[open + 1] !== '^')) return true
  }
  return false
}

function taskDifference(expected: string, actual: string): boolean {
  return expected.includes('<input') && !expected.includes('aria-label=')
    && actual.includes('<input') && actual.includes('aria-label=')
}

function taskLabelBoundary(input: string, expected: string, actual: string): boolean {
  const task = input.trimStart().startsWith('-{') && (input.includes('[x]') || input.includes('[X]') || input.includes('[ ]'))
  return task && expected.includes('aria-label=') && actual.includes('aria-label=') && expected !== actual
}

function tableTab(input: string, expected: string, actual: string): boolean {
  if (expected === actual || !input.includes('\t')) return false
  for (const line of input.split('\n')) {
    if (line.trimStart().startsWith('|') && line.includes('\t')) return true
  }
  return false
}

function missingTab(input: string, expected: string, actual: string): string | null {
  if (!expected.includes('\t') || actual.includes('\t')) return null
  if (input.split('\n').some((line) => line.trimStart().startsWith(':: ') && line.includes('\t')
    || line.trimStart().startsWith(': ') && line.includes('\t'))) return 'U-193'
  if (input.split('\n').some((line) => line.trimStart().startsWith('|') && line.includes('\t---'))) return 'U-194'
  return null
}

function quoteDefinition(input: string, expected: string, actual: string): boolean {
  if (!expected.includes('<blockquote') && !actual.includes('<blockquote')) return false
  return hasDefinitionLine(input, '> [', true) || hasDefinitionLine(input, '>[', true)
    || input.split('\n').some((value) => value.trimStart().startsWith('> *[')
      || value.includes('> [') && value.includes(']:'))
}

function nestedItemDefinition(input: string): boolean {
  for (const line of input.split('\n')) {
    let value = line.trimStart()
    while (value.startsWith('- ') || value.startsWith('* ') || value.startsWith('. ')) {
      value = value.slice(2).trimStart()
    }
    const close = value.indexOf(']:')
    if (value.startsWith('[') && close > 2) return true
    if (value.startsWith('*[') && close > 3) return true
  }
  return false
}

function itemDefinition(input: string, expected: string, actual: string): boolean {
  if (!expected.includes('<li') && !actual.includes('<li')) return false
  return hasDefinitionLine(input, '- [', true) || hasDefinitionLine(input, '* [', true)
    || hasDefinitionLine(input, '. [', true)
    || nestedItemDefinition(input)
}

function lineBlockReport(ctx: Context, input: string, line: number): ReportRecord | null {
  const block = ctx.visits.find((visit) => visit.node.type === 'line_block' && visit.node.pos !== undefined
    && visit.node.pos.startLine <= line && line <= visit.node.pos.endLine)
  if (block?.node.pos === undefined) return null
  const message = input.includes('```')
    ? 'C2-B-123 and C2-B-130 change code fence ownership inside the line block body'
    : 'C2-B-123 and C2-B-130 read the line block body as text lines with retained whitespace'
  return { ...recordOf('U-130', line, message), range: {
    startOffset: block.node.pos.startOffset, endOffset: block.node.pos.endOffset } }
}

function legacyMeasured(ctx: Context, input: string, expected: string, actual: string, line: number): ReportRecord | null {
  if (tableTab(input, expected, actual)) return recordOf('U-140', line,
    'C2-B-171 treats a leading or trailing cell tab as syntax padding')
  if (quoteDefinition(input, expected, actual)) return recordOf('U-134', line,
    'C2-B-032 and C2-B-081 read the definition-shaped quote line as quote text')
  if (itemDefinition(input, expected, actual)) return recordOf('U-131', line,
    'C2-B-081 and C2-B-083 read a definition-shaped item line as text')
  const lineBlock = lineBlockReport(ctx, input, line)
  if (lineBlock !== null) return lineBlock
  if (!expected.includes('<td') && !actual.includes('<td') && hasDefinitionLine(input, '[')) return recordOf('U-132', line,
    'C2-B-081 and C2-B-083 read the empty or container-local definition as text')
  return null
}

function measuredTabOrDiv(input: string, expected: string, actual: string, line: number): ReportRecord | null {
  const tab = missingTab(input, expected, actual)
  if (tab !== null) return recordOf(tab, line,
    'C2-B-027, C2-B-067, and C2-B-171 trim a tab that 0.1 retained as content; no preserving spelling is verified')
  if (input.includes(':::[') && (expected.includes('<div>') || expected.includes('<code>')
    || expected.includes('<strong>'))) return recordOf('U-195', line,
    'C2-B-119 and C2-B-121 place div labels in a metadata slot whose inline contents can change; no preserving spelling is verified')
  return null
}

const CAPTION_LEAD = /(<(?:fig)?caption[^>]*>)[ \t]+/gu

function boundaryReport(input: string, expected: string, actual: string, line: number): ReportRecord | null {
  const tabOrDiv = measuredTabOrDiv(input, expected, actual, line)
  if (tabOrDiv !== null) return tabOrDiv
  if (expected.replace(CAPTION_LEAD, '') !== expected && expected.replace(CAPTION_LEAD, '$1') === actual) return recordOf('U-279', line,
    'C2-B-146 starts the caption text at its first character that is not a space or a tab, and a tab has no escape')
  if (input.includes('</#') && expected.includes('<a href=') && actual.includes('<a href=')) return recordOf('U-206', line,
    'C2-H-095 and C2-H-096 use plain heading text or the caption label and number for a resolved cross-reference')
  if (taskLabelBoundary(input, expected, actual)) return recordOf('U-133', line,
    TASK_PRESENTATION_MESSAGE)
  return null
}

function unresolvedEngineShape(input: string, expected: string, actual: string): boolean {
  if (expected.includes('class="tag"') && actual.includes('#') && input.includes('{#')) return true
  if (input.includes('```') && !input.includes('::: |') && expected.includes('<code>')
    && actual.includes('<code>')) return true
  return (expected.includes('<td') || actual.includes('<td')) && input.includes('\\|') && input.includes(']')
}

function wrappedLinkTitle(input: string, expected: string): boolean {
  if (!expected.includes('title="') || !input.includes('](')) return false
  let link = input.indexOf('](')
  while (link >= 0) {
    const tail = input.indexOf(')', link + 2)
    for (const quote of ['"', "'"]) {
      const open = input.indexOf(quote, link + 2)
      const close = input.indexOf(quote, open + 1)
      if (open >= 0 && close > open && (tail < 0 || open < tail) && input.slice(open, close).includes('\n')) return true
    }
    link = input.indexOf('](', link + 2)
  }
  return false
}

function unresolvedContinuation(input: string): boolean {
  for (const line of input.split('\n')) {
    const value = line.trimStart()
    if (value === '+' || value.endsWith(' +') || value.startsWith('- +') || value.startsWith('* +')) return true
  }
  return false
}

function lateMeasuredReport(ctx: Context, input: string, expected: string, actual: string, line: number): ReportRecord | null {
  const legacy = legacyMeasured(ctx, input, expected, actual, line)
  if (legacy !== null) return legacy
  if (unresolvedContinuation(visibleSource(ctx))) return recordOf('U-209', line,
    'C2-B-059 changes continuation ownership here, and no preserving 0.2 rewrite was verified for this source')
  return null
}

/** Reports the measured, clause-backed HTML changes that have no source rewrite. */
export function measuredReport(ctx: Context, expected: string, actual: string, line: number,
  remainder = false): ReportRecord | null {
  const exact = exactMeasuredReport(ctx.src, line)
  if (exact !== null) return exact
  const input = ctx.src
  if (wrappedLinkTitle(input, expected)) return recordOf('U-221', line,
    'C2-I-068 leaves a wrapped link or image title unresolved by the current 0.2 parser; no preserving spelling was verified')
  const boundary = boundaryReport(input, expected, actual, line)
  if (boundary !== null) return boundary
  if (actual.includes('<br>')) {
    const lazyLine = lineBlockReport(ctx, input, line)
    if (lazyLine !== null) return lazyLine
  }
  if (unresolvedEngineShape(input, expected, actual)) return null
  if (ctx.visits.some((visit) => visit.node.type === 'text' && String(visit.node.value).includes('{{')
    && String(visit.node.value).includes('}}'))) return recordOf('U-011', line,
    'C2-B-201 and C2-B-206 read the include-looking directive as an include')
  if (input.includes('{table') && input.includes('```csv')) return recordOf('U-061', line,
    'the delimited table with malformed quoting changes ownership under the 0.2 table rules')
  if (taskDifference(expected, actual)) return recordOf('U-133', line,
    TASK_PRESENTATION_MESSAGE)
  const catalog = remainderCatalog(expected, actual, line, remainder)
  if (catalog !== null) return catalog
  const measuredId = matchMeasured(input, expected, actual)
  if (measuredId !== null) {
    const example = measuredExamples.find((item) => item.id === measuredId)
    if (example !== undefined) return recordOf(example.id, line, example.message)
  }
  return lateMeasuredReport(ctx, input, expected, actual, line)
}

const OPAQUE: readonly string[] = ['code', 'code_block', 'raw_inline', 'raw_block', 'comment', 'literal_inline', 'frontmatter']

function visibleSource(ctx: Context): string {
  const chars = ctx.src.split('')
  for (const visit of ctx.visits) {
    if (!OPAQUE.includes(visit.node.type) || visit.node.pos === undefined) continue
    const { startOffset, endOffset } = visit.node.pos
    for (let at = startOffset; at < endOffset; at++) if (chars[at] !== '\n') chars[at] = ' '
  }
  return chars.join('')
}
