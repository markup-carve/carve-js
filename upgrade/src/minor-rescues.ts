import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineStart, lineText, readLines } from './source.ts'

interface Candidate {
  entry: string
  output: string
  message: string
}

function candidate(entry: string, output: string, message: string): Candidate {
  return { entry, output, message }
}

function trailingFence(output: string): Candidate[] {
  if (!output.endsWith('\n\n') || !output.includes('```')) return []
  const found: Candidate[] = []
  for (let indent = 0; indent <= 8; indent++) {
    for (let length = 3; length <= 8; length++) {
      found.push(candidate('U-135', output + ' '.repeat(indent) + '`'.repeat(length) + '\n',
        'an explicit closer retains the trailing blank code line'))
    }
  }
  return found
}

function inlineComment(output: string): Candidate[] {
  const found: Candidate[] = []
  let at = output.indexOf('{%')
  while (at >= 0) {
    found.push(candidate('U-136', output.slice(0, at) + '\\' + output.slice(at),
      'the literal brace comment opener was escaped'))
    at = output.indexOf('{%', at + 2)
  }
  return found
}

function emptyItemAttribute(output: string): Candidate[] {
  const found: Candidate[] = []
  const lines = readLines(output)
  for (let line = 1; line <= lines.count; line++) {
    const text = lineText(lines, line).trimStart()
    const item = text.startsWith('- {') || text.startsWith('* {') || text.startsWith('. {')
    const description = text.startsWith(': {')
    if (!item && !description) continue
    const open = output.indexOf('{', lineStart(lines, line))
    const close = output.indexOf('}', open + 1)
    if (close < 0 || close >= lineStart(lines, line + 1)) continue
    found.push(candidate(item ? 'U-137' : 'U-142', output.slice(0, open) + '{% %}' + output.slice(close + 1),
      'the empty item attribute was written as an empty comment'))
  }
  return found
}

function quotedAttribute(output: string): Candidate[] {
  const found: Candidate[] = []
  const lines = readLines(output)
  for (let line = 1; line <= lines.count; line++) {
    const value = lineText(lines, line)
    const open = value.indexOf('{')
    const close = value.indexOf('}', open + 1)
    if (open < 0 || close < 0 || value.slice(close + 1).trim() !== '') continue
    if (!value.slice(0, open).trimEnd().endsWith('>')) continue
    const cut = open > 0 && value[open - 1] === ' ' ? open - 1 : open
    const start = lineStart(lines, line) + cut
    found.push(candidate('U-141', output.slice(0, start) + output.slice(lineStart(lines, line) + close + 1),
      'the attribute line that 0.1 consumed was removed from the quote'))
  }
  return found
}

function captionBoundary(output: string): Candidate[] {
  const found: Candidate[] = []
  const lines = readLines(output)
  for (let line = 2; line <= lines.count; line++) {
    if (!lineText(lines, line).trimStart().startsWith('^ ')) continue
    if (lineText(lines, line - 1).trim() === '') continue
    const at = lineStart(lines, line)
    found.push(candidate('U-138', output.slice(0, at) + '\n' + output.slice(at),
      'a blank line keeps the caret line separate from the preceding block'))
  }
  return found
}

function emptyFootnote(output: string): Candidate[] {
  const found: Candidate[] = []
  let at = output.indexOf('^[')
  while (at >= 0) {
    const close = output.indexOf(']', at + 2)
    if (close >= 0 && output.slice(at + 2, close).trim() === '') {
      found.push(candidate('U-139', output.slice(0, at) + '\\' + output.slice(at),
        'the empty inline footnote marker was escaped'))
    }
    at = output.indexOf('^[', at + 2)
  }
  return found
}

/** Clause-backed spellings found by a bounded full HTML check. */
export function rescueMinor(input: string, output: string, mismatch: ReportRecord): { output: string, record: ReportRecord } | null {
  const expected = html01(input)
  const candidates = [...trailingFence(output), ...inlineComment(output), ...emptyItemAttribute(output),
    ...quotedAttribute(output), ...captionBoundary(output), ...emptyFootnote(output)]
  for (const item of candidates) {
    try {
      if (!compareHtml(expected, html02(item.output, false)).equal) continue
      return { output: item.output, record: recordOf(item.entry, mismatch.line, item.message) }
    } catch { /* A candidate can fail to parse under the new grammar. */ }
  }
  return null
}
