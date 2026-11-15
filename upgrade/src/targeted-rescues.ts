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
  ['U-137', '-{} ', '- '],
  ['U-208', '-{+', '\\-{+']
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
    if (
      open >= 0 &&
      close > at &&
      space > at + 1 &&
      space < close &&
      output.slice(space + 1, close).startsWith('lang')
    ) {
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

function substitutionAttributeCandidates(input: string, output: string): Candidate[] {
  if (!input.includes('{~') || !input.includes('~>') || !output.includes('{+')) return []
  const found: Candidate[] = []
  for (const marker of ['}{.', '}{#']) {
    let at = output.indexOf(marker)
    while (at >= 0) {
      found.push({ id: 'U-200', output: output.slice(0, at + 1) + '\\' + output.slice(at + 1) })
      at = output.indexOf(marker, at + marker.length)
    }
  }
  return found
}

function nestedFootnoteCandidates(output: string): Candidate[] {
  const first = output.indexOf('^[')
  if (first < 0 || output.indexOf('^[', first + 2) < 0) return []
  const prefix = output.slice(0, first + 2)
  return [{ id: 'U-202', output: prefix + output.slice(first + 2).replaceAll('^[', '\\^[') }]
}

function floatingAttributeCandidates(output: string): Candidate[] {
  const found: Candidate[] = []
  const lines = readLines(output)
  for (let line = 1; line <= lines.count; line++) {
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

function underlineBoundaryCandidates(output: string): Candidate[] {
  const found: Candidate[] = []
  let at = output.indexOf('_}/')
  while (at >= 0) {
    found.push({ id: 'U-065', output: output.slice(0, at + 2) + '\\' + output.slice(at + 2) })
    at = output.indexOf('_}/', at + 3)
  }
  return found
}

function unresolvedFootnoteAttributeCandidates(output: string): Candidate[] {
  if (!output.includes('[^')) return []
  const found: Candidate[] = []
  for (const [marker, offset] of [
    [']{.', 1],
    [']{#', 2]
  ] as const) {
    let at = output.indexOf(marker)
    while (at >= 0) {
      found.push({ id: 'U-207', output: output.slice(0, at + offset) + '\\' + output.slice(at + offset) })
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
  }
  if (descriptionFence > 0 && line > descriptionFence && line - descriptionFence <= 5 && value.startsWith(' ')) {
    found.push({ id: 'U-179', output: output.slice(0, start) + value.trimStart() + output.slice(lineEnd(lines, line)) })
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
    if (value.startsWith('[@]:'))
      found.push({ id: 'U-187', output: output.slice(0, start) + ' ' + output.slice(start) })
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
    if (value.includes(': ```')) descriptionFence = line
    found.push(...descriptionLineCandidates(output, lines, line, descriptionFence))
  }
  return found
}

function multilineAttributeCandidates(output: string): Candidate[] {
  const lines = output.split('\n')
  const found: Candidate[] = []
  for (let at = 0; at < lines.length - 2; at++) {
    const head = lines[at] ?? ''
    const continuation = (lines[at + 1] ?? '').trimStart()
    if (head.lastIndexOf('{') <= head.lastIndexOf('}') || !continuation.includes('}')) continue
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

function quotedCaretCandidates(input: string): Candidate[] {
  const lines = readLines(input)
  const found: Candidate[] = []
  for (let line = 2; line <= lines.count; line++) {
    const value = lineText(lines, line)
    if (!value.trimStart().startsWith('^ ')) continue
    if (!lineText(lines, line - 1).trimStart().startsWith('> ')) continue
    const at = lineStart(lines, line) + value.length - value.trimStart().length
    found.push({ id: 'U-212', output: input.slice(0, at) + '\\' + input.slice(at) })
  }
  return found
}

function itemDefinitionCandidates(input: string): Candidate[] {
  const lines = input.split('\n')
  const found: Candidate[] = []
  for (let at = 0; at < lines.length; at++) {
    const match = /^(\s*(?:(?:[-*.]|\d+[.)])\s+)+)(\[[^\]\n]+\]:[^\n]*)$/.exec(lines[at] ?? '')
    if (match === null || match[1] === undefined || match[2] === undefined) continue
    const changed = [...lines]
    changed[at] = match[1] + '{% %}'
    found.push({ id: 'U-213', output: match[2] + '\n\n' + changed.join('\n') })
  }
  return found
}

function tableCodeSpanCandidates(input: string): Candidate[] {
  const lines = input.split('\n')
  const found: Candidate[] = []
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at] ?? ''
    if (!line.trimStart().startsWith('|') || !line.trimEnd().endsWith('|')) continue
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

/** Exact HTML decides whether a candidate spelling preserves 0.1 rendering. */
export function rescueTargeted(
  input: string,
  output: string,
  mismatch: ReportRecord
): { output: string; record: ReportRecord } | null {
  const expected = html01(input)
  const candidates = [
    ...simpleCandidates(output),
    ...bracketCandidates(output),
    ...lineCandidates(output),
    ...multilineAttributeCandidates(input),
    ...quotedCaretCandidates(input),
    ...itemDefinitionCandidates(input),
    ...tableCodeSpanCandidates(input),
    ...smartQuoteCandidates(output, expected),
    ...metadataCandidates(output),
    ...languageCandidates(output),
    ...quotedBraceCandidates(output),
    ...substitutionAttributeCandidates(input, output),
    ...nestedFootnoteCandidates(output),
    ...floatingAttributeCandidates(output),
    ...underlineBoundaryCandidates(output),
    ...unresolvedFootnoteAttributeCandidates(output)
  ]
  for (const candidate of candidates) {
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
  return null
}
