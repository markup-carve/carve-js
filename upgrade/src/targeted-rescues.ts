import { closedRunCandidates } from './backtick-rescue.ts'
import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { type Gate, OPEN_SITE, type Site } from './rescue-site.ts'
import { insideQuotes } from './rules/lines.ts'
import { lineEnd, lineStart, lineText, readLines } from './source.ts'

interface Candidate {
  id: string
  output: string
}

const SIMPLE: readonly [string, string, string][] = [
  ['U-181', '</#', '</\\#'],
  ['U-184', '- {{', '- \\{{'],
  // C2-B-171: a header mark before the cell end, which 0.1 read as the text `=`.
  ['X-003', '|=|', '|\\=|'],
  ['U-188', ':+-:', ':\\+-:'],
  ['U-189', '[^]', '[\\^]'],
  ['U-137', '-{} ', '- ']
]

function simpleCandidates(output: string, gate: Gate): Candidate[] {
  const found: Candidate[] = []
  for (const [id, from, to] of SIMPLE) {
    let at = output.indexOf(from)
    while (at >= 0) {
      if ((id !== 'X-003' || output[at + from.length] !== '|') && gate.at(at, at + from.length)) {
        found.push({ id, output: output.slice(0, at) + to + output.slice(at + from.length) })
      }
      at = output.indexOf(from, at + from.length)
    }
    if (id !== 'X-003' && output.includes(from)) {
      found.push({ id, output: output.replaceAll(from, to) })
    }
  }
  return found
}

function bracketCandidates(output: string, gate: Gate): Candidate[] {
  const found: Candidate[] = []
  let at = output.indexOf(':::[')
  while (at >= 0) {
    const end = output.indexOf(']', at + 4)
    const label = end < 0 ? '' : output.slice(at + 4, end)
    const id = label.includes('`') || label.includes('+') ? 'U-178' : 'U-186'
    if (gate.at(at)) found.push({ id, output: output.slice(0, at + 3) + ' ' + output.slice(at + 3) })
    at = output.indexOf(':::[', at + 4)
  }
  const openers = '* / + - ~ _ = ^ ,'
  at = output.indexOf('[{')
  while (at >= 0) {
    if (openers.includes(output[at + 2] ?? '\0') && gate.at(at)) {
      found.push({ id: 'U-182', output: output.slice(0, at + 1) + '\\' + output.slice(at + 1) })
      if (output[at + 2] === '*' || output[at + 2] === '/') {
        found.push({ id: 'U-182', output: output.slice(0, at + 2) + '\\' + output.slice(at + 2) })
      }
    }
    at = output.indexOf('[{', at + 2)
  }
  return found
}

function smartQuoteCandidates(output: string, expected: string, gate: Gate): Candidate[] {
  const found: Candidate[] = []
  if (output.includes('{+') || output.includes('{-')) return found
  if (expected.includes('“') && output.split('="').length > 2) {
    found.push({ id: 'U-190', output: output.replaceAll('="', '=“') })
  }
  for (const quote of ['\u2018', '\u2019', '\u201c', '\u201d']) {
    if (!expected.includes(quote)) continue
    const plain = quote === '\u2018' || quote === '\u2019' ? "'" : '"'
    let at = output.indexOf(plain)
    while (at >= 0) {
      if (gate.at(at)) found.push({ id: 'U-190', output: output.slice(0, at) + quote + output.slice(at + 1) })
      at = output.indexOf(plain, at + 1)
    }
  }
  return found
}

function languageCandidates(output: string, gate: Gate): Candidate[] {
  const found: Candidate[] = []
  let combined = output
  let at = output.indexOf(':')
  while (at >= 0) {
    const open = output.lastIndexOf('{', at)
    const close = output.indexOf('}', at)
    const space = output.indexOf(' ', at)
    if (
      open >= 0 &&
      close > at &&
      space > at + 1 &&
      space < close &&
      output.slice(space + 1, close).startsWith('lang')
    ) {
      const next = output.slice(0, at) + output.slice(space + 1)
      if (gate.at(at, space)) found.push({ id: 'U-192', output: next })
      combined = combined.replace(output.slice(at, space + 1), '')
    }
    at = output.indexOf(':', at + 1)
  }
  if (combined !== output) found.push({ id: 'U-192', output: combined })
  // A run of attribute lines: the shorthand lines go when 0.1 took a later `lang` line.
  const lines = output.split('\n')
  const shorthand = /^ *\{:[\w-]+\} *$/u
  const kept = lines.filter((line, index) => !shorthand.test(line)
    || !lines.slice(index + 1).some((later) => /^ *\{[^}]*\blang=/u.test(later)))
  if (kept.length !== lines.length) found.push({ id: 'U-192', output: kept.join('\n') })
  return found
}

function substitutionAttributeCandidates(input: string, output: string, gate: Gate): Candidate[] {
  if (!input.includes('{~') || !input.includes('~>') || !output.includes('{+')) return []
  const found: Candidate[] = []
  for (const marker of ['}{.', '}{#']) {
    let at = output.indexOf(marker)
    while (at >= 0) {
      if (gate.at(at)) found.push({ id: 'U-200', output: output.slice(0, at + 1) + '\\' + output.slice(at + 1) })
      at = output.indexOf(marker, at + marker.length)
    }
  }
  return found
}

function floatingAttributeCandidates(output: string, gate: Gate): Candidate[] {
  const found: Candidate[] = []
  const lines = readLines(output)
  for (let line = 1; line <= lines.count; line++) {
    if (!gate.lines(line, line + 1)) continue
    const value = lineText(lines, line)
    const trimmed = value.trimStart()
    const start = lineStart(lines, line)
    const end = lineEnd(lines, line)
    if (trimmed.startsWith('> {') && trimmed.endsWith('}')) {
      found.push({
        id: 'U-141',
        output: output.slice(0, start) + value.slice(0, value.indexOf('>') + 1) + output.slice(end)
      })
    }
    if (!['{.', '{#', '{:', '{lang='].some((prefix) => trimmed.startsWith(prefix)) || !trimmed.endsWith('}')) continue
    const id =
      trimmed.startsWith('{:') &&
      lineText(lines, line + 1)
        .trimStart()
        .startsWith('{lang=')
        ? 'U-192'
        : 'U-197'
    found.push({ id, output: output.slice(0, start) + output.slice(lineStart(lines, line + 1)) })
    found.push({ id, output: output.slice(0, start) + output.slice(end) })
  }
  return found
}

function underlineBoundaryCandidates(output: string, gate: Gate): Candidate[] {
  const found: Candidate[] = []
  let at = output.indexOf('_}/')
  while (at >= 0) {
    if (gate.at(at)) found.push({ id: 'U-065', output: output.slice(0, at + 2) + '\\' + output.slice(at + 2) })
    at = output.indexOf('_}/', at + 3)
  }
  return found
}

function unresolvedFootnoteAttributeCandidates(output: string, gate: Gate): Candidate[] {
  if (!output.includes('[^')) return []
  const found: Candidate[] = []
  for (const [marker, offset] of [
    [']{.', 1],
    [']{#', 2]
  ] as const) {
    let at = output.indexOf(marker)
    while (at >= 0) {
      if (gate.at(at)) found.push({ id: 'U-207', output: output.slice(0, at + offset) + '\\' + output.slice(at + offset) })
      at = output.indexOf(marker, at + marker.length)
    }
  }
  return found
}

function descriptionLineCandidates(
  output: string,
  lines: ReturnType<typeof readLines>,
  line: number,
  descriptionFence: number
): Candidate[] {
  const value = lineText(lines, line)
  const start = lineStart(lines, line)
  const found: Candidate[] = []
  if (
    value.trimStart().startsWith(':: ') &&
    lineText(lines, line + 1)
      .trimStart()
      .startsWith(': ')
  ) {
    for (let indent = 1; indent <= 4; indent++) {
      found.push({ id: 'U-180', output: output.slice(0, start) + ' '.repeat(indent) + output.slice(start) })
    }
  } else if (value.startsWith('>') && insideQuotes(value).trimStart().startsWith(':: ')
    && insideQuotes(lineText(lines, line + 1)).trimStart().startsWith(': ')) {
    // In a quote the term moves past its marks.
    const marks = value.length - insideQuotes(value).length
    for (let indent = 1; indent <= 4; indent++) {
      found.push({ id: 'U-180', output: output.slice(0, start + marks) + ' '.repeat(indent) + output.slice(start + marks) })
    }
  }
  if (descriptionFence > 0 && line > descriptionFence && line - descriptionFence <= 5 && value.startsWith(' ')) {
    found.push({ id: 'U-179', output: output.slice(0, start) + value.trimStart() + output.slice(lineEnd(lines, line)) })
  }
  return found
}

function lineCandidates(output: string, gate: Gate): Candidate[] {
  const found: Candidate[] = []
  const lines = readLines(output)
  let descriptionFence = 0
  for (let line = 1; line <= lines.count; line++) {
    const value = lineText(lines, line)
    if (value.includes(': ```')) descriptionFence = line
    if (!gate.lines(line, line + 2)) continue
    const start = lineStart(lines, line)
    if (value.startsWith('[@]:'))
      found.push({ id: 'U-187', output: output.slice(0, start) + ' ' + output.slice(start) })
    // U-183, C2-B-147: an unresolved block image reference above a caption is a figure in 0.2.
    if (
      value.startsWith('![') &&
      lineText(lines, line + 1)
        .trimStart()
        .startsWith('^ ')
    ) {
      const escaped = output.slice(0, start) + '\\' + output.slice(start)
      found.push({ id: 'U-183', output: escaped })
      if (lineText(lines, line + 2).trimStart().startsWith('^ ')) {
        const nextCaption = lineStart(lines, line + 2) + 1
        found.push({ id: 'U-183', output: escaped.slice(0, nextCaption) + '\n' + escaped.slice(nextCaption) })
      }
    }
    found.push(...descriptionLineCandidates(output, lines, line, descriptionFence))
  }
  return found
}

function multilineAttributeCandidates(output: string, gate: Gate): Candidate[] {
  const lines = output.split('\n')
  const found: Candidate[] = []
  for (let at = 0; at < lines.length - 2; at++) {
    const head = lines[at] ?? ''
    const continuation = (lines[at + 1] ?? '').trimStart()
    if (head.lastIndexOf('{') <= head.lastIndexOf('}') || !continuation.includes('}')) continue
    if (!gate.lines(at + 1, at + 3)) continue
    const body = continuation.startsWith('>') ? continuation.slice(1).trimStart() : continuation
    const changed = [...lines]
    changed[at] = head.trimEnd() + ' ' + body
    changed.splice(at + 1, 1)
    found.push({ id: 'U-211', output: changed.join('\n') })
    if ((changed[at + 1] ?? '') !== '') continue
    changed.splice(at + 1, 1)
    found.push({ id: 'U-211', output: changed.join('\n') })
  }
  return found
}

function quotedCaretCandidates(input: string, gate: Gate): Candidate[] {
  const lines = readLines(input)
  const found: Candidate[] = []
  for (let line = 2; line <= lines.count; line++) {
    const value = lineText(lines, line)
    if (!value.trimStart().startsWith('^ ')) continue
    if (!lineText(lines, line - 1).trimStart().startsWith('> ') || !gate.lines(line)) continue
    const at = lineStart(lines, line) + value.length - value.trimStart().length
    found.push({ id: 'U-212', output: input.slice(0, at) + '\\' + input.slice(at) })
  }
  return found
}

function itemDefinitionCandidates(input: string, gate: Gate): Candidate[] {
  const lines = input.split('\n')
  const found: Candidate[] = []
  for (let at = 0; at < lines.length; at++) {
    const match = /^(\s*(?:(?:[-*.]|\d+[.)])\s+)+)(\[[^\]\n]+\]:[^\n]*)$/.exec(lines[at] ?? '')
    if (match === null || match[1] === undefined || match[2] === undefined || !gate.lines(at + 1)) continue
    const changed = [...lines]
    changed[at] = match[1] + '{% %}'
    found.push({ id: 'U-213', output: match[2] + '\n\n' + changed.join('\n') })
  }
  return found
}

function tableCodeSpanCandidates(input: string, gate: Gate): Candidate[] {
  const lines = input.split('\n')
  const found: Candidate[] = []
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at] ?? ''
    if (!line.trimStart().startsWith('|') || !line.trimEnd().endsWith('|') || !gate.lines(at + 1)) continue
    const open = line.indexOf('`')
    if (open < 0) continue
    let end = open
    while (line[end] === '`') end++
    const mark = '`'.repeat(end - open)
    if (line.indexOf(mark, end) >= 0) continue
    let close = line.lastIndexOf('|')
    if (line[close - 1] === ' ') close--
    const changed = [...lines]
    changed[at] = line.slice(0, close) + mark + line.slice(close)
    found.push({ id: 'U-214', output: changed.join('\n') })
  }
  return found
}

const MAX_TRIALS = 64

/** Exact HTML decides whether a candidate spelling preserves 0.1 rendering. */
export function rescueTargeted(
  input: string,
  output: string,
  mismatch: ReportRecord,
  site: Site = OPEN_SITE
): { output: string; record: ReportRecord } | null {
  const expected = html01(input)
  const near = site.output
  const sources: (() => Candidate[])[] = [
    () => simpleCandidates(output, near),
    () => bracketCandidates(output, near),
    () => lineCandidates(output, near),
    () => multilineAttributeCandidates(input, site.input),
    () => quotedCaretCandidates(input, site.input),
    () => itemDefinitionCandidates(input, site.input),
    () => tableCodeSpanCandidates(input, site.input),
    () => smartQuoteCandidates(output, expected, near),
    () => smartQuoteCandidates(output, expected, near).flatMap((candidate) => closedRunCandidates(candidate.output, 'U-190', near)),
    () => languageCandidates(output, near),
    () => substitutionAttributeCandidates(input, output, near),
    () => floatingAttributeCandidates(output, near),
    () => underlineBoundaryCandidates(output, near),
    () => unresolvedFootnoteAttributeCandidates(output, near)
  ]
  let trials = 0
  for (const source of sources) {
    for (const candidate of source()) {
      // Each trial renders the whole document, so a line with an opener per few bytes made this quadratic.
      if (trials++ >= MAX_TRIALS) return null
      try {
        if (!compareHtml(expected, html02(candidate.output, false)).equal) continue
        return {
          output: candidate.output,
          record: recordOf(candidate.id, mismatch.line, 'the clause-backed spelling preserves the complete 0.1 HTML')
        }
      } catch {
        /* A candidate can fail to parse under the new grammar. */
      }
    }
  }
  return null
}
