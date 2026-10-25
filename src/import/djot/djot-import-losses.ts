import { djotBlockLayout } from './djot-block-layout.js'
import { djotItemPrefix } from './djot-inline-boundaries.js'
import { djotDestinationLines } from './djot-destination-lines.js'
import { djotEmphasis } from './djot-emphasis.js'
import { EXTENDER_LEADING_SPAN_UNSPELLABLE } from '../markdown/import-report-messages.js'
import { djotInlineBoundaries, isDjotEscaped, maskDjotCodeAndDestinations } from '../../djot-migrate.js'
import { readAttributes } from './djot-word-attributes.js'
import { djotCollapsedReferenceCache } from './djot-collapsed-reference.js'

export type DjotImportLoss = {
  code: 'structure-unspellable' | 'djot-attribute-dropped'
  message: string
  line: number
}

const definitionKey = (label: string): string => label.trim().replace(/[ \t\r\n]+/g, ' ')
const referenceKey = (label: string): string =>
  definitionKey(label.replace(/\\([ \t!-\/:-@\[-`{-~])/g, '$1'))

type LossReport = (message: string, line: number) => void
type CollapsedReferenceText = ReturnType<typeof djotCollapsedReferenceCache>

interface LossScan {
  source: string
  lines: string[]
  offsets: number[]
  rows: readonly boolean[]
  contentStart: (line: string) => number
  quoteDepths: number[]
  lineAt: (at: number) => number
  report: LossReport
}

interface DefinitionScan {
  definitions: Map<string, string>
  definitionLines: Set<number>
  headingLines: Set<number>
}

interface LineView {
  n: number
  line: string
  at: number
  content: string
  visible: string
  contentMask: string
  previousContent: string
  item: boolean
  boundary: boolean | undefined
}

interface LinkFrame {
  at: number
  nested: boolean
  plain: boolean
  first: string
  last: string
}

interface LinkScan {
  masked: string[]
  escaped: Uint8Array
  boundaries: readonly number[]
  referenceEnds: Int32Array
  destinations: ReadonlyMap<number, number>
  definitions: ReadonlyMap<string, string>
  rawFormatIgnored: Array<[number, number]>
  collapsedReferenceText: CollapsedReferenceText
  imageChildText: ((label: string, quoteDepth: number) => string) | undefined
}

const RAW_FORMAT_MESSAGE = 'A Djot raw-format identifier containing U+0085 cannot be spelled in Carve; its raw-output behavior is lost.'
const EMPTY_TERM_PREFIX = /^(?:[ \t]*(?:(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+)+|(?:>[ \t]*)*(?:(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+)*|[ \t]*)$/

function lineOffsets(lines: readonly string[]): number[] {
  const offsets: number[] = []
  let offset = 0
  for (const line of lines) {
    offsets.push(offset)
    offset += line.length + 1
  }
  return offsets
}

function lineFinder(offsets: readonly number[]): (at: number) => number {
  return (at: number): number => {
    let low = 0,
      high = offsets.length
    while (low + 1 < high) {
      const mid = (low + high) >>> 1
      if (offsets[mid]! <= at) low = mid
      else high = mid
    }
    return low + 1
  }
}

function reportCodeSpanContainerOpeners(scan: LossScan, codeSource: string): void {
  const { source, lines, offsets, contentStart, quoteDepths, lineAt, report } = scan
  const chars = codeSource.split('')
  for (let line = 0; line < lines.length; line++) {
    let depth = 0
    const prefix = lines[line]!.slice(0, contentStart(lines[line]!))
    for (let i = 0; i < prefix.length; i++)
      if (prefix[i] === '>' && ++depth > quoteDepths[line]!) chars[offsets[line]! + i] = ' '
  }
  const spans: { at: number; end: number; closed: boolean }[] = []
  let spanEnd = 0
  maskDjotCodeAndDestinations(chars.join(''), false, true, false, undefined, [], {
    destinations: true, comments: true, attributeValues: true,
    onCode: (at, end, closed) => {
      if (at >= spanEnd) { spans.push({ at, end, closed }); spanEnd = end }
    },
  })
  for (const { at, end, closed } of spans) {
    const line = lineAt(at)
    if (quoteDepths[line - 1]! > 0) continue
    let width = 1
    while (source[at + width] === '`') width++
    const content = source.slice(at + width, end - (closed ? width : 0))
    if (/\n[ \t]*:{3,}(?:[ \t]+[^\n]*)?(?:\n|$)/.test(content))
      report('A multiline code span contains a Carve container opener on a continuation line.', line)
  }
}

function maskAttributeRuns(source: string, masked: string[]): void {
  for (let at = 0; at < source.length; at++) {
    if (masked[at] !== '{' || isDjotEscaped(source, at)) continue
    const attrs = readAttributes(source, at)
    if (!attrs) continue
    for (let k = at; k < attrs.end; k++) if (masked[k] !== '\n') masked[k] = ' '
    at = attrs.end - 1
  }
}

function headingAttributes(
  scan: LossScan,
  definitionLines: ReadonlySet<number>,
  line: number,
  column: number,
): { start: number; boundary: boolean; id?: string } {
  const { source, lines, offsets, rows, contentStart, quoteDepths } = scan
  let start = line, end = offsets[line]!, id: string | undefined
  for (let prior = line - 1; prior >= 0; prior--) {
    let begin = prior
    while (begin > 0) {
      const value = lines[begin]!.slice(contentStart(lines[begin]!)).trimStart()
      if (value.startsWith('{') || value === '' || /^(?:#{1,6}(?:[ \t]|$)|:{3,}|[`~]{3,}|[-*+][ \t])/.test(value)) break
      begin--
    }
    const attributeAt = contentStart(lines[begin]!)
    if (attributeAt < column || quoteDepths[begin]! < quoteDepths[line]!) break
    const absolute = offsets[begin]! + attributeAt
    const attrs = source[absolute] === '{' ? readAttributes(source, absolute) : undefined
    if (!attrs || attrs.end <= offsets[prior]! || attrs.end > end || source.slice(attrs.end, end).trim() !== '') break
    start = begin
    let token: (typeof attrs.tokens)[number] | undefined
    for (const value of attrs.tokens) if (value.key === 'id') token = value
    if (token && id === undefined)
      id = token.source.startsWith('#') ? token.source.slice(1) : token.source.slice(3).replace(/^"|"$/g, '').replace(/\\([\\"])/g, '$1')
    end = offsets[begin]!
    prior = begin
  }
  const before = start > 0 ? lines[start - 1]!.slice(contentStart(lines[start - 1]!)).trim() : ''
  const boundary = start === line || before === '' || rows[start - 1] || definitionLines.has(start - 1) || /^(?:#{1,6}(?: |$)|:{3,}|[`~]{3,}|\[[^\]\n]+\]:|(?:[-*][ \t]*){3,}$)/.test(before)
  return { start, boundary, ...id === undefined ? {} : { id } }
}

function readLineView(scan: LossScan, definitionLines: ReadonlySet<number>, masked: readonly string[], n: number): LineView {
  const { lines, offsets, rows, contentStart } = scan
  const line = lines[n]!,
    visible = masked.slice(offsets[n]!, offsets[n]! + line.length).join('')
  const at = contentStart(line),
    content = line.slice(at),
    contentMask = visible.slice(at)
  const previous = lines[n - 1] ?? ''
  const previousContent = previous.slice(contentStart(previous)).trim()
  const item = /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+/.test(djotItemPrefix(line, at))
  const boundary =
    previousContent === '' ||
    rows[n - 1] ||
    item ||
    definitionLines.has(n - 1) ||
    /^(?:#{1,6}(?: |$)|:{3,}|[`~]{3,}|\{|\[[^\]]+\]:)/.test(previousContent) ||
    /^(?:[*-][ \t]*){3,}$/.test(previousContent) ||
    (contentStart(previous) > at &&
      /(?:>|[-*+] |[0-9A-Za-z]+[.)] |\([0-9A-Za-z]+\) )/.test(djotItemPrefix(previous, contentStart(previous))))
  return { n, line, at, content, visible, contentMask, previousContent, item, boundary }
}

function acceptDefinition(
  scan: LossScan,
  defs: DefinitionScan,
  masked: string[],
  rawFormatIgnored: Array<[number, number]>,
  n: number,
  decision: { label: string; target: string; end: number },
): void {
  const { lines, offsets } = scan
  rawFormatIgnored.push([offsets[n]!, offsets[decision.end]! + lines[decision.end]!.length])
  for (let next = n + 1; next <= decision.end; next++) defs.definitionLines.add(next)
  defs.definitions.set(definitionKey(decision.label), decision.target)
  defs.definitionLines.add(n)
  for (let k = offsets[n]!; k < offsets[n]! + lines[n]!.length; k++) masked[k] = ' '
}

/** Join a heading's continuation lines, marking each one as consumed. */
function headingText(scan: LossScan, headingLines: Set<number>, view: LineView, heading: RegExpExecArray): string {
  const { lines, contentStart } = scan
  const { n, line, at, content } = view
  let text = content.slice(heading[0].length)
  let lastPart = text
  const marker = new RegExp(`^${heading[1]}[ \\t]+`)
  for (let next = n + 1; next < lines.length; next++) {
    const following = lines[next]!
    const prefix = following.slice(0, contentStart(following))
    if (
      (prefix.match(/>/g) ?? []).length !== (line.slice(0, at).match(/>/g) ?? []).length ||
      /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+/.test(djotItemPrefix(following, contentStart(following)))
    )
      break
    const part = following.slice(contentStart(following))
    if (!part.trim() || /(?:^|[^\\])(?:\\\\)*\\$/.test(lastPart)) break
    if (marker.test(part)) { lastPart = part.replace(marker, ''); text += '\n' + lastPart }
    else {
      if (
        /^(?:[#>|{]|[-*+][ \t]|[0-9A-Za-z]+[.)][ \t]|:[ \t]|:{2,}|\([0-9a-zA-Z]+\)[ \t]|[`~]{3,}|\[[^\]\n]*\]:|(?:[*-][ \t]*){3,}$)/.test(
          part,
        )
      )
        break
      lastPart = part
      text += '\n' + part
    }
    headingLines.add(next)
  }
  return text
}

function scanHeadingLine(
  scan: LossScan,
  defs: DefinitionScan,
  view: LineView,
  collapsedReferenceText: CollapsedReferenceText,
): void {
  const { n, at, content, contentMask, boundary } = view
  const heading = contentMask.startsWith('#') ? /^(#{1,6})(?:[ \t]+|$)/.exec(content) : null
  const attributes = heading ? headingAttributes(scan, defs.definitionLines, n, at) : undefined
  const headingBoundary = boundary || !!attributes && attributes.start < n && attributes.boundary
  if (heading && headingBoundary && !defs.headingLines.has(n)) {
    const text = headingText(scan, defs.headingLines, view, heading)
    const label = collapsedReferenceText(text)
    const key = definitionKey(label)
    const identifier = key.replace(/[\]\[~!@#$%^&*(){}`,.<>\\|=+/?\s]+/g, ' ').trim().replace(/ +/g, '-')
    const target = '#' + (attributes?.id ?? (identifier || 's-1'))
    if (attributes?.boundary && !defs.definitions.has(key)) defs.definitions.set(key, target)
  }
  if (/^#{1,6}[ \t]*$/.test(contentMask) && heading && collapsedReferenceText(content.slice(heading[0].length)).trim() === '' && boundary && !defs.headingLines.has(n)) {
    const next = scan.lines[n + 1]?.trim() ?? ''
    if (next === '' || /^(?:[#>|{]|[-*+] |:{3,}|`{3,}|~{3,})/.test(next))
      scan.report('An empty heading cannot be spelled in Carve.', n + 1)
  }
}

function reportEmptyDefinitionTerm(scan: LossScan, masked: readonly string[], view: LineView): void {
  const { n, line, boundary } = view
  if (/^(?:[ \t]*>[ \t]*)*:[ \t]*$/.test(line) && boundary && masked[scan.offsets[n]! + line.indexOf(':')] === ':')
    if (!EMPTY_TERM_PREFIX.test(line.slice(0, line.indexOf(':'))))
      scan.report('An empty definition term is omitted during import.', n + 1)
}

function reportEmptyDefinitionDescription(scan: LossScan, view: LineView): void {
  const { lines, contentStart } = scan
  const { n, line, at, visible, contentMask, previousContent, item } = view
  const term = /:[ \t]+$/.exec(visible.slice(0, at))
  if (
    !term ||
    !(term.index === 0 || /[ \t]/.test(visible[term.index - 1]!)) ||
    !/^\S/.test(contentMask) ||
    !(previousContent === '' || n === 0 || item)
  )
    return
  const quoteDepth = (line.slice(0, at).match(/>/g) ?? []).length
  const inContainer = (next: string): boolean =>
    (next.slice(0, contentStart(next)).match(/>/g) ?? []).length === quoteDepth
  const blank = (next: string): boolean => next.slice(contentStart(next)).trim() === ''
  const withoutQuotes = (next: string): string => {
    const lastQuote = next.slice(0, contentStart(next)).lastIndexOf('>')
    return lastQuote < 0 ? next : next.slice(lastQuote + 1).replace(/^[ \t]/, '')
  }
  const minimum = withoutQuotes(line.slice(0, term.index)).length + 2
  const continuesTerm = (next: string): boolean => {
    const content = withoutQuotes(next)
    return (
      !/^[ \t]*(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\)|:)[ \t]+/.test(content) ||
      /^[ \t]*/.exec(content)![0].length > minimum - 2
    )
  }
  let end = n + 1
  while (end < lines.length && inContainer(lines[end]!) && !blank(lines[end]!) && continuesTerm(lines[end]!)) end++
  while (end < lines.length && blank(lines[end]!)) end++
  if (
    end === lines.length ||
    !inContainer(lines[end]!) ||
    /^[ \t]*/.exec(withoutQuotes(lines[end]!))![0].length < minimum
  ) {
    if (!EMPTY_TERM_PREFIX.test(line.slice(0, term.index)))
      scan.report('An empty definition description is omitted during import.', n + 1)
  }
}

function reportTableRowLosses(scan: LossScan, n: number, content: string): void {
  const { lines, rows, contentStart, report } = scan
  const separator = /^\|(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*$/.test(content)
  if (separator && rows[n - 1] && rows[n - 2])
    report('A separator inside a table promotes another header row; Carve cannot spell it.', n + 1)
  if (separator && !rows[n - 1]) {
    let end = n
    while (rows[end] && /^\|(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*$/.test(lines[end]!.slice(contentStart(lines[end]!))))
      end++
    if (!rows[end]) report('A table containing only separator rows cannot be spelled in Carve.', n + 1)
  }
  // A row of blank cells is a Carve row (CARVE-P9-082), but Carve reads a tab
  // between the pipes as content where Djot reads padding.
  if (/^\|(?:[ \t]*\|)+[ \t]*$/.test(content) && content.trimEnd().includes('\t'))
    report('A blank table cell holding a tab reads as tab content in Carve.', n + 1)
}

function escapedPositions(source: string): Uint8Array {
  const escaped = new Uint8Array(source.length)
  let slashes = 0
  for (let at = 0; at < source.length; at++) {
    escaped[at] = slashes % 2
    slashes = source[at] === '\\' ? slashes + 1 : 0
  }
  return escaped
}

/** For each position, the next unescaped `]` before any `[` or inline boundary. */
function referenceEndTable(source: string, masked: readonly string[], escaped: Uint8Array, breaks: ReadonlySet<number>): Int32Array {
  const referenceEnds = new Int32Array(source.length + 1).fill(-1)
  let next = -1
  for (let at = source.length - 1; at >= 0; at--) {
    if (breaks.has(at)) next = -1
    else if (masked[at] === ']' && !escaped[at]) next = at
    else if (masked[at] === '[' && !escaped[at]) next = -1
    referenceEnds[at] = next
  }
  return referenceEnds
}

function carryNested(stack: LinkFrame[], nested: boolean): void {
  const parent = stack.at(-1)
  if (parent) {
    parent.plain = false
    if (nested) parent.nested = true
  }
}

/** Track a label's text; return the position to resume from when it skips ahead. */
function trackLabelText(scan: LossScan, links: LinkScan, current: LinkFrame, at: number): number | undefined {
  const { source, quoteDepths, lineAt } = scan
  const { masked, escaped } = links
  const ch = source[at]!
  const point = String.fromCodePoint(source.codePointAt(at)!)
  if ((point.length === 1 ? masked[at] : masked.slice(at, at + point.length).join('')) !== point || escaped[at] || !/[\p{L}\p{N}\p{M} ,;?/=&@\t\n]/u.test(point) || ch === '\n' && !/[\p{L}\p{N}\p{M},;?/=&@]/u.test(current.last)) current.plain = false
  if (point.length > 1) { current.first ||= point; current.last = point; return at + 1 }
  if (!current.first) current.first = ch
  current.last = ch
  if (ch === '\n' && current.plain) {
    const depth = quoteDepths[lineAt(current.at) - 1]!
    if (depth > 0 && quoteDepths[lineAt(at + 1) - 1] === depth) {
      const prefix = /^(?:[ \t]*>[ \t])+/.exec(source.slice(at + 1))?.[0]
      if (prefix && (prefix.match(/>/g) ?? []).length === depth) return at + prefix.length
    }
  }
  return undefined
}

/** Resolve the destination after `]`, or undefined when the brackets are not a link. */
function linkTarget(
  scan: LossScan,
  links: LinkScan,
  open: number,
  at: number,
  image: boolean,
): { end: number; destination: string | undefined } | undefined {
  const { source, quoteDepths, lineAt, report } = scan
  const end = at + 1
  if (source[end] === '(') {
    const destinationEnd = links.destinations.get(end)
    if (destinationEnd === undefined) return undefined
    return {
      end: destinationEnd,
      destination: djotDestinationLines(source.slice(end + 1, destinationEnd - 1), quoteDepths[lineAt(open) - 1]!),
    }
  }
  if (source[end] !== '[') return undefined
  const start = end + 1
  const close = links.referenceEnds[start]!
  if (close < 0) return undefined
  links.rawFormatIgnored.push([start, close])
  const explicit = source.slice(start, close)
  const label = source.slice(open + 1, at)
  const key = explicit ? referenceKey(explicit) : definitionKey(
    links.definitions.size === 0 ? '' : links.collapsedReferenceText(label, quoteDepths[lineAt(open) - 1]!, image),
  )
  const destination = links.definitions.get(key)
  if (destination === undefined) {
    report(image ? 'An unresolved Djot image reference has no src; Carve cannot spell that image.' : 'An unresolved Djot reference has no href; Carve cannot spell that link.', lineAt(open))
  }
  return { end: close + 1, destination }
}

function reportImageAltLosses(scan: LossScan, links: LinkScan, opener: LinkFrame, at: number): void {
  const { source, quoteDepths, lineAt, report } = scan
  const open = opener.at
  const label = source.slice(open + 1, at)
  if (!label.includes('\n') || opener.plain) return
  const childText = (links.imageChildText ?? links.collapsedReferenceText)(label, quoteDepths[lineAt(open) - 1]!)
  if (/\n[ \t]*\n/.test(childText))
    report('An image alternative text with a blank line cannot be spelled in Carve.', lineAt(open))
  else if (/[ \t]+\n/.test(childText))
    report('An image alternative text loses trailing spaces before a line break.', lineAt(open))
}

/** Close the link or image whose `]` sits at `at`; return the position to resume from. */
function closeLink(scan: LossScan, links: LinkScan, stack: LinkFrame[], at: number): number {
  const { source, lineAt, report } = scan
  const opener = stack.pop()
  if (opener === undefined) return at
  if (source[opener.at + 1] === '^' && at > opener.at + 2) {
    links.rawFormatIgnored.push([opener.at, at + 1])
    carryNested(stack, opener.nested)
    return at
  }
  const open = opener.at
  const image = source[open - 1] === '!' && !links.escaped[open - 1]
  const target = linkTarget(scan, links, open, at, image)
  if (target === undefined) {
    carryNested(stack, opener.nested)
    return at
  }
  const { end, destination } = target
  if (image) links.rawFormatIgnored.push([open, at + 1])
  if (image && destination !== undefined && destination !== '') reportImageAltLosses(scan, links, opener, at)
  if (!image) {
    if (opener.nested) report('A link inside another link cannot be spelled in Carve.', lineAt(open))
    const parent = stack.at(-1)
    if (parent) parent.nested = true
  }
  const parent = stack.at(-1)
  if (parent) {
    if (!image || destination === undefined || destination === '' || !opener.plain) parent.plain = false
    if (!parent.first) parent.first = opener.first
    if (opener.last) parent.last = opener.last
  }
  return end - 1
}

function scanLinkLosses(scan: LossScan, links: LinkScan): void {
  const { source } = scan
  const { masked, escaped, boundaries } = links
  const stack: LinkFrame[] = []
  let boundary = 0
  for (let at = 0; at < source.length; at++) {
    while ((boundaries[boundary] ?? source.length) <= at) {
      stack.length = 0
      boundary++
    }
    const current = stack.at(-1), ch = source[at]!
    if (current && ch !== '[' && ch !== ']' && !(ch === '!' && source[at + 1] === '[')) {
      const resume = trackLabelText(scan, links, current, at)
      if (resume !== undefined) { at = resume; continue }
    }
    if (masked[at] !== ch || escaped[at]) continue
    if (ch === '[') {
      if (current && (source[at - 1] !== '!' || escaped[at - 1])) current.plain = false
      stack.push({ at, nested: false, plain: true, first: '', last: '' })
      continue
    }
    if (ch === ']') at = closeLink(scan, links, stack, at)
  }
}

function reportRawFormats(
  scan: LossScan,
  rawFormats: ReadonlyArray<[number, number]>,
  rawFormatIgnored: Array<[number, number]>,
): void {
  rawFormatIgnored.sort((a, b) => a[0] - b[0])
  let ignoredIndex = 0, ignoredEnd = -1
  for (const [start, end] of rawFormats) {
    while (ignoredIndex < rawFormatIgnored.length && rawFormatIgnored[ignoredIndex]![0] <= start)
      ignoredEnd = Math.max(ignoredEnd, rawFormatIgnored[ignoredIndex++]![1])
    if (ignoredEnd < end) scan.report(RAW_FORMAT_MESSAGE, scan.lineAt(start))
  }
}

/** Detect losses before any rewrite can move a source line. */
export function djotImportLosses(
  source: string,
  rows: readonly boolean[],
  contentStart: (line: string) => number,
  rawCode: readonly number[] = [],
  accepted: ReadonlyMap<number, { label: string; target: string; end: number }>,
  definitionsOnly?: Map<string, string>,
  codeSource = source,
  imageChildText?: (label: string, quoteDepth: number) => string,
): DjotImportLoss[] {
  const collapsedReferenceText = djotCollapsedReferenceCache()
  const losses: DjotImportLoss[] = []
  const reported = new Set<string>()
  const lines = source.split('\n')
  const quoteDepths = lines.map(line => (line.slice(0, contentStart(line)).match(/>/g) ?? []).length)
  if (quoteDepths.some(depth => depth > 0))
    djotBlockLayout(source, rows, undefined, undefined, undefined, undefined, (line, depth) => { quoteDepths[line] = depth })
  const offsets = lineOffsets(lines)
  const lineAt = lineFinder(offsets)
  const report = (message: string, line: number): void => {
    const key = `${line}:${message}`
    if (!reported.has(key)) {
      reported.add(key)
      losses.push({ code: 'structure-unspellable', message, line })
    }
  }
  const scan: LossScan = { source, lines, offsets, rows, contentStart, quoteDepths, lineAt, report }
  for (const at of rawCode) report('Multiline inline code uses raw HTML; plain-text export omits it.', lineAt(at))
  if (source.includes('`') && source.includes(':::')) reportCodeSpanContainerOpeners(scan, codeSource)
  djotEmphasis(
    source,
    (text) => text,
    (at) => report('Emphasis exceeding the native nesting budget is flattened; its text is preserved.', lineAt(at)),
    false,
    (at) => report(EXTENDER_LEADING_SPAN_UNSPELLABLE, lineAt(at)),
  )
  const rawFormats: Array<[number, number]> = []
  const rawFormatIgnored: Array<[number, number]> = []
  const rawFenceLines = new Set<number>()
  const maskSource = source.includes('\u0085') ? lines.map((line, n) => line.replace(
    /(`{3,}|~{3,})([ \t]*=)([^\s{}%"'`~\\]+)([ \t]*)$/,
    (all, ticks: string, prefix: string, format: string, tail: string) => {
      if (!format.includes('\u0085')) return all
      rawFenceLines.add(n)
      return ticks + prefix + format.replace(/[^A-Za-z0-9_+#.-]/g, 'x') + tail
    },
  )).join('\n') : source
  const destinations = new Map<number, number>()
  const masked = maskDjotCodeAndDestinations(maskSource, false, true, false, undefined, [], {
    destinations: true, autolinks: true, comments: true,
    onDestination: (start, end) => destinations.set(start, end),
    onFenceOpen: n => { if (rawFenceLines.has(n)) report(RAW_FORMAT_MESSAGE, n + 1) },
    onRawFormat: (start, end, format) => {
      if (format.includes('\u0085') && !(source[start - 1] === '$' && !isDjotEscaped(source, start - 1))) rawFormats.push([start, end])
    },
  }).split('')
  maskAttributeRuns(source, masked)
  const defs: DefinitionScan = { definitions: new Map(), definitionLines: new Set(), headingLines: new Set() }
  for (let n = 0; n < lines.length; n++) {
    if (defs.definitionLines.has(n)) continue
    const view = readLineView(scan, defs.definitionLines, masked, n)
    const decision = accepted.get(n)
    if (decision) acceptDefinition(scan, defs, masked, rawFormatIgnored, n, decision)
    scanHeadingLine(scan, defs, view, collapsedReferenceText)
    reportEmptyDefinitionTerm(scan, masked, view)
    reportEmptyDefinitionDescription(scan, view)
    if (rows[n]) reportTableRowLosses(scan, n, view.content)
  }
  if (definitionsOnly) {
    for (const [key, target] of defs.definitions) definitionsOnly.set(key, target)
    return losses
  }
  const escaped = escapedPositions(source)
  const boundaries = djotInlineBoundaries(source, masked.join(''))
  scanLinkLosses(scan, {
    masked,
    escaped,
    boundaries,
    referenceEnds: referenceEndTable(source, masked, escaped, new Set(boundaries)),
    destinations,
    definitions: defs.definitions,
    rawFormatIgnored,
    collapsedReferenceText,
    imageChildText,
  })
  reportRawFormats(scan, rawFormats, rawFormatIgnored)
  return losses.sort((a, b) => a.line - b.line)
}
