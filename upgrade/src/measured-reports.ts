import { recordOf, type ReportRecord } from './report.ts'
import measuredExamples from '../data/measured-reports.json' with { type: 'json' }
import { matchMeasured } from './measured-matchers.ts'

export const MEASURED_REPORT_IDS: readonly string[] = measuredExamples.map((item) => item.id)

export function exactMeasuredReport(input: string, line: number): ReportRecord | null {
  const example = measuredExamples.find((item) => item.input === input)
  return example === undefined ? null : recordOf(example.id, line, example.message)
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

function legacyMeasured(input: string, expected: string, actual: string, line: number): ReportRecord | null {
  if (tableTab(input, expected, actual)) return recordOf('U-140', line,
    'C2-B-171 treats a leading or trailing cell tab as syntax padding')
  if (quoteDefinition(input, expected, actual)) return recordOf('U-134', line,
    'C2-B-032 and C2-B-081 read the definition-shaped quote line as quote text')
  if (itemDefinition(input, expected, actual)) return recordOf('U-131', line,
    'C2-B-081 and C2-B-083 read a definition-shaped item line as text')
  if (input.includes('::: |')) return recordOf('U-130', line,
    'C2-B-123 and C2-B-130 read the line block body as text lines with retained whitespace')
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

function unresolvedEngineShape(input: string, expected: string, actual: string): boolean {
  if (expected.includes('class="tag"') && actual.includes('#') && input.includes('{#')) return true
  if (input.includes('```') && expected.includes('<code>') && actual.includes('<code>')) return true
  return (expected.includes('<td') || actual.includes('<td')) && input.includes('\\|') && input.includes(']')
}

function lineCommentInContainer(input: string): boolean {
  if (input.includes('%%%')) return false
  return input.split('\n').some((line) => line.trimStart().startsWith('%% '))
}

/** Reports the measured, clause-backed HTML changes that have no source rewrite. */
export function measuredReport(input: string, expected: string, actual: string, line: number): ReportRecord | null {
  const exact = exactMeasuredReport(input, line)
  if (exact !== null) return exact
  const tabOrDiv = measuredTabOrDiv(input, expected, actual, line)
  if (tabOrDiv !== null) return tabOrDiv
  if (unresolvedEngineShape(input, expected, actual)) return null
  if (lineCommentInContainer(input)) return recordOf('U-146', line,
    'C2-B-133 and C2-I-044 end the percent line comment at its container boundary')
  if (input.includes('{{') && input.includes('}}')) return recordOf('U-011', line,
    'C2-B-201 and C2-B-206 read the include-looking directive as an include')
  if (input.includes('{table') && input.includes('```csv')) return recordOf('U-061', line,
    'the delimited table with malformed quoting changes ownership under the 0.2 table rules')
  if (taskDifference(expected, actual)) return recordOf('U-133', line,
    'C2-H-032 adds the task item class, style, and plain-text checkbox label')
  const measuredId = matchMeasured(input, expected, actual)
  if (measuredId !== null) {
    const example = measuredExamples.find((item) => item.id === measuredId)
    if (example !== undefined) return recordOf(example.id, line, example.message)
  }
  return legacyMeasured(input, expected, actual, line)
}
