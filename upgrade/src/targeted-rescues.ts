import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineEnd, lineStart, lineText, readLines } from './source.ts'

interface Candidate {
  id: string
  output: string
}

const SIMPLE: readonly [string, string, string][] = [
  ['U-181', '</#', '</\\#'],
  ['U-184', '- {{', '- \\{{'],
  ['U-185', '|=|', '|\\=|'],
  ['U-188', ':+-:', ':\\+-:'],
  ['U-189', '[^]', '[\\^]'],
]

function simpleCandidates(output: string): Candidate[] {
  const found: Candidate[] = []
  for (const [id, from, to] of SIMPLE) {
    let at = output.indexOf(from)
    while (at >= 0) {
      if (id !== 'U-185' || output[at + from.length] !== '|') {
        found.push({ id, output: output.slice(0, at) + to + output.slice(at + from.length) })
      }
      at = output.indexOf(from, at + from.length)
    }
    if (id !== 'U-185' && output.includes(from)) {
      found.push({ id, output: output.replaceAll(from, to) })
    }
  }
  return found
}

function bracketCandidates(output: string): Candidate[] {
  const found: Candidate[] = []
  let at = output.indexOf(':::[')
  while (at >= 0) {
    const end = output.indexOf(']', at + 4)
    const label = end < 0 ? '' : output.slice(at + 4, end)
    const id = label.includes('`') || label.includes('+') ? 'U-178' : 'U-186'
    found.push({ id, output: output.slice(0, at + 3) + ' ' + output.slice(at + 3) })
    at = output.indexOf(':::[', at + 4)
  }
  const openers = '* / + - ~ _ = ^ ,'
  at = output.indexOf('[{')
  while (at >= 0) {
    if (openers.includes(output[at + 2] ?? '\0')) {
      found.push({ id: 'U-182', output: output.slice(0, at + 1) + '\\' + output.slice(at + 1) })
    }
    at = output.indexOf('[{', at + 2)
  }
  return found
}

function smartQuoteCandidates(output: string, expected: string): Candidate[] {
  const found: Candidate[] = []
  if (output.includes('{+') || output.includes('{-')) return found
  for (const quote of ['\u2018', '\u2019', '\u201c', '\u201d']) {
    if (!expected.includes(quote)) continue
    const plain = quote === '\u2018' || quote === '\u2019' ? "'" : '"'
    let at = output.indexOf(plain)
    while (at >= 0) {
      found.push({ id: 'U-190', output: output.slice(0, at) + quote + output.slice(at + 1) })
      at = output.indexOf(plain, at + 1)
    }
  }
  return found
}

function metadataCandidates(output: string): Candidate[] {
  const found: Candidate[] = []
  const lines = readLines(output)
  for (let line = 1; line <= lines.count; line++) {
    const value = lineText(lines, line)
    if (!value.trimStart().startsWith('```') && !value.trimStart().startsWith(':::')) continue
    const first = value.indexOf('"')
    const last = value.indexOf('"', first + 1)
    if (first < 0 || last < 0) continue
    if (last + 1 < value.length && value.charCodeAt(last + 1) > 0x20) continue
    const at = lineStart(lines, line) + first
    const begin = at > 0 && output[at - 1] === ' ' ? at - 1 : at
    const end = lineStart(lines, line) + last + 1
    found.push({ id: 'U-191', output: output.slice(0, begin) + output.slice(end) })
    found.push({ id: 'U-191', output: output.slice(0, begin) + output.slice(lineEnd(lines, line)) })
  }
  return found
}

function languageCandidates(output: string): Candidate[] {
  const found: Candidate[] = []
  let combined = output
  let at = output.indexOf(':')
  while (at >= 0) {
    const open = output.lastIndexOf('{', at)
    const close = output.indexOf('}', at)
    const space = output.indexOf(' ', at)
    if (open >= 0 && close > at && space > at + 1 && space < close
      && output.slice(space + 1, close).startsWith('lang')) {
      const next = output.slice(0, at) + output.slice(space + 1)
      found.push({ id: 'U-192', output: next })
      combined = combined.replace(output.slice(at, space + 1), '')
    }
    at = output.indexOf(':', at + 1)
  }
  if (combined !== output) found.push({ id: 'U-192', output: combined })
  return found
}

function quotedBraceCandidates(output: string): Candidate[] {
  const found: Candidate[] = []
  let at = output.indexOf("='")
  while (at >= 0) {
    const close = output.indexOf("'", at + 2)
    if (close > at + 2) {
      const value = output.slice(at + 2, close)
      if (value.includes('}') && !value.includes('"')) {
        found.push({ id: 'U-196', output: output.slice(0, at + 1) + '"' + value + '"' + output.slice(close + 1) })
      }
    }
    at = output.indexOf("='", at + 2)
  }
  return found
}

function lineCandidates(output: string): Candidate[] {
  const found: Candidate[] = []
  const lines = readLines(output)
  let descriptionFence = 0
  for (let line = 1; line <= lines.count; line++) {
    const value = lineText(lines, line)
    const start = lineStart(lines, line)
    if (value.startsWith('[@]:')) found.push({ id: 'U-187', output: output.slice(0, start) + ' ' + output.slice(start) })
    if (value.startsWith('![') && lineText(lines, line + 1).trimStart().startsWith('^ ')) {
      found.push({ id: 'U-183', output: output.slice(0, start) + '\\' + output.slice(start) })
    }
    if (value.trimStart().startsWith(':: ') && lineText(lines, line + 1).trimStart().startsWith(': ')) {
      for (let indent = 1; indent <= 4; indent++) {
        found.push({ id: 'U-180', output: output.slice(0, start) + ' '.repeat(indent) + output.slice(start) })
      }
    }
    if (value.includes(': ```')) descriptionFence = line
    if (descriptionFence > 0 && line > descriptionFence && line - descriptionFence <= 5 && value.startsWith(' ')) {
      found.push({ id: 'U-179', output: output.slice(0, start) + value.trimStart() + output.slice(lineEnd(lines, line)) })
    }
  }
  return found
}

/** Exact HTML decides whether a candidate spelling preserves 0.1 rendering. */
export function rescueTargeted(input: string, output: string, mismatch: ReportRecord):
  { output: string, record: ReportRecord } | null {
  const expected = html01(input)
  const candidates = [...simpleCandidates(output), ...bracketCandidates(output), ...lineCandidates(output),
    ...smartQuoteCandidates(output, expected), ...metadataCandidates(output), ...languageCandidates(output),
    ...quotedBraceCandidates(output)]
  for (const candidate of candidates) {
    try {
      if (!compareHtml(expected, html02(candidate.output, false)).equal) continue
      return { output: candidate.output, record: recordOf(candidate.id, mismatch.line,
        'the clause-backed spelling preserves the complete 0.1 HTML') }
    } catch { /* A candidate can fail to parse under the new grammar. */ }
  }
  return null
}
