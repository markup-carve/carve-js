import map from '../../data/upgrade-map.json' with { type: 'json' }
import { compareHtmlExact } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { makeContext, type Context, type Visit } from './context.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineOf, readLines } from './source.ts'
import { newMapCandidates } from './new-map-candidates.ts'
import { newMapRange, replayMapRange } from './new-map-ranges.ts'
import { sameHost } from './tabs.ts'

const REWRITE_IDS = new Set([
  'U-278', 'U-280', 'U-281',
  'U-284', 'U-285', 'U-286', 'U-445', 'U-290', 'U-300', 'U-304', 'U-305', 'U-340', 'U-365', 'U-366',
  'U-367', 'U-368', 'U-369', 'U-375', 'U-376', 'U-377',
  'U-399', 'U-400', 'U-401', 'U-402', 'U-405', 'U-406', 'U-407', 'U-427',
])
const REPORT_IDS = new Set([
  'U-262', 'U-263', 'U-264', 'U-271', 'U-279', 'U-282', 'U-283', 'U-287', 'U-288', 'U-289',
  'U-249', 'U-291', 'U-292', 'U-293', 'U-301', 'U-302', 'U-303', 'U-341', 'U-362', 'U-364', 'U-370', 'U-371',
  'U-378', 'U-379', 'U-380', 'U-381', 'U-382', 'U-383', 'U-384', 'U-385', 'U-386', 'U-387',
  'U-388', 'U-389', 'U-391', 'U-394', 'U-395',
  'U-393', 'U-397', 'U-398', 'U-403', 'U-404', 'U-408', 'U-409', 'U-410', 'U-411',
  'U-426', 'U-428',
  'U-414', 'U-415', 'U-417', 'U-419',
])

const BY_SOURCE = new Map(map.source.filter((row) => REWRITE_IDS.has(row.id)).map((row) => [row.from, row]))
const REPORTS = new Map<string, typeof map.source>()
for (const row of map.source.filter((item) => REPORT_IDS.has(item.id))) {
  const list = REPORTS.get(row.from) ?? []
  list.push(row)
  REPORTS.set(row.from, list)
}

function rendersLikeOld(input: string, candidate: string): boolean {
  try { return compareHtmlExact(html01(input), html02(candidate, false)).equal } catch { return false }
}

interface CapPair { open: number; close: number }

// Count the inline path, not enclosing quote, list or div nodes in the AST path.
const INLINE_DEPTH_NODES = new Set([
  'paragraph', 'heading', 'table_cell', 'citation_definition', 'span', 'emphasis', 'strong', 'underline',
  'strike', 'highlight', 'superscript', 'subscript', 'insert', 'delete', 'substitution', 'link',
  'inline_footnote', 'inline_extension', 'ruby', 'small_caps',
])

/** The 0.1 text at its shared block and inline cap can contain a complete attributed pair. */
function inlineDepth(visit: Visit): number {
  let depth = 0
  for (let parent: Visit | null = visit.parent; parent !== null; parent = parent.parent) {
    if (INLINE_DEPTH_NODES.has(parent.node.type)) depth++
  }
  return depth
}

function unescaped(text: string, at: number): boolean {
  let slashes = 0
  while (text[at - slashes - 1] === '\\') slashes++
  return slashes % 2 === 0
}

function pairsInText(text: string, start: number): CapPair[] {
  const pairs: CapPair[] = []
  const stack: number[] = []
  for (let at = 0; at < text.length; at++) {
    if (text[at] !== '[' && text[at] !== ']' || !unescaped(text, at)) continue
    if (text[at] === '[') { stack.push(at); continue }
    const open = stack.pop()
    if (open === undefined || !/^\{[^{}\r\n]+\}/u.test(text.slice(at + 1))) continue
    pairs.push({ open: start + open, close: start + at })
  }
  return pairs
}

function literalCapPairs(input: string): CapPair[] {
  if (!input.includes(']{')) return []
  return makeContext(input).visits.flatMap((visit) => {
    const pos = visit.node.pos
    if (visit.node.type !== 'text' || pos === undefined || inlineDepth(visit) !== 200) return []
    return pairsInText(input.slice(pos.startOffset, pos.endOffset), pos.startOffset)
  })
}

function capCandidate(input: string, pairs: readonly CapPair[]): string {
  let output = input
  const offsets = pairs.flatMap(({ open, close }) => [open, close]).sort((a, b) => b - a)
  for (const at of offsets) {
    output = output.slice(0, at) + '\\' + output.slice(at)
  }
  return output
}

function mappedCandidates(input: string, row: (typeof map.source)[number] | undefined,
  additional: { id: string; output: string }[], pairs: readonly CapPair[]): { id: string; output: string }[] {
  if (row !== undefined && row.to !== input) return [{ id: row.id, output: row.to }, ...additional]
  return [...additional, ...(pairs.length > 0 ? [{ id: 'U-445', output: capCandidate(input, pairs) }] : [])]
}

function mappedCandidateRecord(id: string, row: (typeof map.source)[number] | undefined,
  pairs: readonly CapPair[], input: string): ReportRecord {
  const pair = id === 'U-445' ? pairs[0] ?? literalCapPairs(input)[0] : undefined
  const line = pair === undefined ? 1 : lineOf(readLines(input), pair.open)
  const record = recordOf(id, line, row?.id === id ? row.meaning02 : 'the source has a preserving 0.2 spelling')
  if (pair !== undefined) record.range = { startOffset: pair.open, endOffset: pair.close + 1 }
  return record
}

/** Exact catalog examples have a promised spelling; accept it only when both renderers confirm it. */
export function mappedRewrite(input: string): { output: string; record: ReportRecord } | null {
  const row = BY_SOURCE.get(input)
  const additional = newMapCandidates(input)
  const capPairs = row === undefined ? literalCapPairs(input) : []
  if (row === undefined && additional.length === 0 && capPairs.length === 0) return null
  // A candidate is unnecessary when the authored spelling already has the old HTML.
  if (row === undefined && rendersLikeOld(input, input)) return null
  for (const candidate of mappedCandidates(input, row, additional, capPairs)) {
    if (!(candidate.id === 'U-427' ? sameHost(input, candidate.output) : rendersLikeOld(input, candidate.output))) continue
    return { output: candidate.output, record: mappedCandidateRecord(candidate.id, row, capPairs, input) }
  }
  return null
}

/** A kept difference remains visible even when a small example happens to render alike. */
export function mappedReport(input: string): ReportRecord[] {
  return (REPORTS.get(input) ?? []).map((row) => {
    const range = newMapRange(input, row.id) ?? (Number(row.id.slice(2)) >= 397
      ? { startOffset: 0, endOffset: input.length } : undefined)
    return range === undefined ? recordOf(row.id, 1, row.meaning02)
      : { ...recordOf(row.id, lineOf(readLines(input), range.startOffset), row.meaning02), range }
  })
}

/** A residual HTML difference in a larger source can still cite its mapped construct. */
export function mappedRemainderReport(input: string, old: string, next: string, differenceLine: number): ReportRecord | null {
  const pair = literalCapPairs(input)[0]
  const found = pair === undefined ? replayMapRange(input, old, next)
    : { id: 'U-445', range: { startOffset: pair.open, endOffset: pair.close + 1 } }
  if (found === null) return null
  const row = map.source.find((item) => item.id === found.id)
  if (row === undefined) return null
  const line = lineOf(readLines(input), found.range.startOffset)
  if (found.id !== 'U-445' && differenceLine > 0 && Math.abs(line - differenceLine) > 5) return null
  return { ...recordOf(found.id, line, row.meaning02), range: found.range }
}

/** U-249 remains an explicit review row even though HTML names now compare without case. */
export function mathClassReport(ctx: Context): ReportRecord | null {
  for (const match of ctx.src.matchAll(/\$`[^`\n]*`(\{CLASS=[^}\n]+\})/gu)) {
    if (match.index === undefined || match[1] === undefined) continue
    const end = match.index + match[0].length
    const parsedMath = ctx.visits.some(({ node }) => node.type === 'math'
      && node.pos?.startOffset === match.index && node.pos.endOffset >= end)
    if (!parsedMath) continue
    const startOffset = end - match[1].length
    return { ...recordOf('U-249', lineOf(ctx.lines, startOffset),
      'the inline math class key uses its canonical lowercase name in 0.2'),
    range: { startOffset, endOffset: end } }
  }
  return null
}
