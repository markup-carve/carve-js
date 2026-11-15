import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineEnd, lineStart, lineText, readLines } from './source.ts'

interface Rescue {
  output: string
  record: ReportRecord
}

function startsBlock(value: string): boolean {
  return ['# ', '```', ':::', '***', '- ', '* '].some((prefix) => value.startsWith(prefix))
}

function variants(output: string, mismatchLine: number): string[] {
  const lines = readLines(output)
  const found = new Set<string>()
  for (let line = Math.max(1, mismatchLine - 3); line <= Math.min(lines.count, mismatchLine + 3); line++) {
    const value = lineText(lines, line)
    const trimmed = value.trimStart()
    const start = lineStart(lines, line)
    const end = lineEnd(lines, line)
    if (trimmed.startsWith(':: ') || trimmed.startsWith(': ')) {
      for (let indent = 0; indent <= 8; indent++) {
        const candidate = output.slice(0, start) + ' '.repeat(indent) + trimmed + output.slice(end)
        if (candidate !== output) found.add(candidate)
      }
    }
    const above = lineText(lines, line - 1).trimStart()
    const block = startsBlock(trimmed)
    if (value !== trimmed && block && (above.startsWith(': ') || above === '')) {
      found.add(output.slice(0, start) + trimmed + output.slice(end))
      if (above !== '') found.add(output.slice(0, start) + '\n' + trimmed + output.slice(end))
    }
  }
  return [...found]
}

function plusVariants(input: string): string[] {
  const found: string[] = []
  const lines = input.split('\n')
  for (let line = 1; line < Math.min(lines.length - 1, 10); line++) {
    const body = (lines[line] ?? '').trimStart()
    const term = (lines[line - 1] ?? '').trimStart()
    if (!term.startsWith(':: ') || !body.startsWith(': ') || body.slice(1).trim() !== '+') continue
    const follower = (lines[line + 1] ?? '').trimStart()
    for (let indent = 0; indent <= 4; indent++) {
      const changed = [...lines]
      changed[line - 1] = ' '.repeat(indent) + term
      changed[line] = ' '.repeat(indent) + ': {% %}'
      changed[line + 1] = '\n' + ' '.repeat(indent) + follower
      found.push(changed.join('\n'))
    }
    const direct = [...lines]
    const markerColumn = (lines[line] ?? '').indexOf(':')
    direct[line] = (lines[line] ?? '').slice(0, markerColumn) + ': ' + follower
    direct.splice(line + 1, 1)
    found.push(direct.join('\n'))
  }
  return found
}

function isListMarker(value: string): boolean {
  return value.startsWith('- ') || value.startsWith('* ') || value.startsWith('. ')
}

function boundaryVariants(output: string): string[] {
  const lines = output.split('\n')
  const found: string[] = []
  for (let at = 1; at < lines.length - 1; at++) {
    const previous = (lines[at - 1] ?? '').trimStart()
    const current = (lines[at] ?? '').trimStart()
    if (previous.startsWith(': ') && current.startsWith('>')) {
      const changed = [...lines]
      changed[at] = '\n' + current
      found.push(changed.join('\n'))
    }
    if (previous.startsWith(': ') && current.startsWith('{') && current.endsWith('}')) {
      const changed = [...lines]
      changed[at] = ''
      found.push(changed.join('\n'))
    }
    if (!isListMarker(previous)) continue
    if (!current.startsWith(':: ') || !(lines[at + 1] ?? '').trimStart().startsWith(': ')) continue
    const changed = [...lines]
    changed[at] = '\n' + current
    changed[at + 1] = (lines[at + 1] ?? '').trimStart()
    found.push(changed.join('\n'))
  }
  return found
}

/** C2-B-069, C2-B-076 and C2-B-078: put the mark and body at an owning column. */
export function rescueDescription(input: string, output: string, mismatch: ReportRecord): Rescue | null {
  if (!input.includes('::')) return null
  const expected = html01(input)
  for (const candidate of variants(output, Math.max(1, mismatch.line))) {
    try {
      if (!compareHtml(expected, html02(candidate, false)).equal) continue
      const id = input.startsWith(':: ') && candidate.startsWith(' :: ') ? 'U-180' : 'U-128'
      return { output: candidate, record: recordOf(id, mismatch.line,
        'the description mark was moved to its 0.2 ownership column while preserving 0.1 HTML') }
    } catch { /* A candidate can fail to parse under the new grammar. */ }
  }
  for (const candidate of plusVariants(input)) {
    try {
      if (!compareHtml(expected, html02(candidate, false)).equal) continue
      return { output: candidate, record: recordOf('U-123', mismatch.line,
        'the description continuation was written as an empty block and a separated follower') }
    } catch { /* A candidate can fail to parse under the new grammar. */ }
  }
  for (const candidate of [...boundaryVariants(input), ...boundaryVariants(output)]) {
    try {
      if (!compareHtml(expected, html02(candidate, false)).equal) continue
      return { output: candidate, record: recordOf('U-199', mismatch.line,
        'the description boundary was written at its 0.2 owning column while preserving 0.1 HTML') }
    } catch { /* A candidate can fail to parse under the new grammar. */ }
  }
  return null
}
