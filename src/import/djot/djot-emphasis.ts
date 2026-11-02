import { MAX_NESTING_DEPTH } from '../../parse.js'
import { djotPlaceholderPrefix } from './djot-placeholder-prefix.js'
import { djotStructuralPrefixEnd } from './djot-structural-prefix.js'
import { djotInlineBoundaries, isDjotEscaped, maskDjotCodeAndDestinations } from '../../djot-migrate.js'
import { extendsGrapheme } from '../../grapheme-extender.js'
import { nativeAttributeReader } from './djot-attributes.js'

type Pair = {
  start: number
  openEnd: number
  close: number
  end: number
  kind: string
  forced: boolean
  children: Pair[]
  kinds: Set<string>
  hostDepth?: number
}
type Opener = { start: number; end: number; kind: string; forced: boolean }

export { djotStructuralPrefixSteps, djotStructuralPrefixEnd } from './djot-structural-prefix.js'

export function djotEmphasis(source: string, convert: (plain: string) => string, flattened?: (offset: number) => void, omitQuoteDelimiters = false, extenderLeading?: (offset: number) => void): string {
  return processDjotEmphasis(source, convert, undefined, flattened, omitQuoteDelimiters, false, extenderLeading)
}

export function djotReferenceEmphasis(source: string, convert: (plain: string) => string): string {
  return processDjotEmphasis(source, convert, undefined, undefined, true, true)
}

export function djotPairedEmphasisOpeners(source: string): Map<number, number> {
  const paired = new Map<number, number>()
  processDjotEmphasis(source, plain => plain, paired)
  return paired
}

type DjotAttributeRun = NonNullable<ReturnType<ReturnType<typeof nativeAttributeReader>>>
type AttributeScan = {
  attributes: Map<number, DjotAttributeRun>
  emptyBlockAttributes: Set<number>
  listBoundaryComments: Map<number, string>
}
type BraceScan = {
  validBraces: Set<number>
  validBraceClosers: Set<number>
  braceEnds: Map<number, number>
  literalDashes: Set<number>
}
type DelimiterScan = {
  pairs: Pair[]
  structural: Set<number>
  omittedQuoteBraces: Set<number>
  bracketPairs: Array<[number, number]>
}
type EmphasisOptions = {
  omitQuoteDelimiters: boolean
  flattened?: ((offset: number) => void) | undefined
  extenderLeading?: ((offset: number) => void) | undefined
}

const BRACED_KINDS = '+-=^~_*'
const LIST_ITEM_PREFIX = /^[ \t>]*(?:(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+)?/
const LIST_ITEM_MARKER = /^[ \t]*(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+/
const CODE_FENCE_LINE = /^[ \t]*(?:`{3,}|~{3,})/
const BLOCK_RESET_LINE = /^[ \t]*(?:`{3,}|~{3,}|:{3,}|\{[ \t.#A-Za-z}%])/
const RAW_ATTRIBUTE = /^\{=[^\s{}`]+\}/

function processDjotEmphasis(source: string, convert: (plain: string) => string, paired?: Map<number, number>, flattened?: (offset: number) => void, omitQuoteDelimiters = false, imageLabels = false, extenderLeading?: (offset: number) => void): string {
  const mask = maskFootnotes(maskDjotEmphasisSource(source, imageLabels)).replace(/<[^<>\s]+>/g, value => /[^:]@|[A-Za-z]:/.test(value) ? ' '.repeat(value.length) : value).replace(/(?<=\])\[[^\]\n]*\]/gm, value => ' '.repeat(value.length)).split('')
  const cells = djotTableCellPipes(source)
  const attributes = scanDjotAttributes(source, mask)
  const braces = scanBracedDelimiters(source, mask, cells, paired)
  const delimiters = new DelimiterPairer(source, mask, cells, braces, omitQuoteDelimiters, paired).run()
  if (paired) {
    for (const pair of delimiters.pairs) paired.set(pair.openEnd - 1, pair.end)
    return source
  }
  addBracedHighlights(delimiters.pairs, source, braces)
  const roots = nestPairs(delimiters.pairs)
  const starts = new Map(delimiters.pairs.map((pair) => [pair.start, pair]))
  const literalBrackets = literalBracketPositions(source, mask, braces, delimiters, starts)
  assignHostDepths(source, braces, delimiters.bracketPairs, literalBrackets, starts)
  const renderer = new EmphasisRenderer(source, mask, attributes, braces, delimiters, literalBrackets, { omitQuoteDelimiters, flattened, extenderLeading })
  return renderer.document(roots, convert)
}

function djotTableCellPipes(source: string): Set<number> {
  const cells = new Set<number>()
  if (!source.includes('|')) return cells
  const cellMask = maskDjotCodeAndDestinations(source, false, true, false, undefined, [], { destinations: false, autolinks: false, attributeValues: false })
  for (const at of djotInlineBoundaries(source, cellMask)) if (source[at] === '|' && cellMask[at] === '|') cells.add(at)
  return cells
}

function isQuotedBlank(line: string): boolean {
  return line.replace(/^(?:[ \t]*>)*[ \t]*/, '').trim() === ''
}

/** Tracks the line around each `{` so an empty `{}` can be told apart as block metadata. */
class AttributeLineTracker {
  lineStart = 0
  lineEnd = -1
  prefixEnd = 0
  indent = 0
  previousItemWidth = 0
  private listAttribute = false
  private previousContent = ''
  private previousLine = ''
  private activeListColumn: number | undefined

  constructor(private readonly source: string) {}

  advanceTo(at: number): void {
    while (this.lineEnd < at) this.nextLine()
  }

  standsAlone(): boolean {
    return this.listAttribute || this.lineStart === 0 || this.previousContent.trim() === '' || /^\{.*\}$/.test(this.previousContent.trim()) || this.indent < this.previousItemWidth
  }

  private nextLine(): void {
    const source = this.source
    if (this.lineEnd >= 0) {
      this.previousLine = source.slice(this.lineStart, this.lineEnd)
      this.lineStart = this.lineEnd + 1
    }
    const newline = source.indexOf('\n', this.lineStart)
    this.lineEnd = newline < 0 ? source.length : newline
    const line = source.slice(this.lineStart, this.lineEnd)
    const prefix = LIST_ITEM_PREFIX.exec(line)![0]
    this.prefixEnd = this.lineStart + prefix.length
    this.previousContent = this.previousLine.replace(/^(?:[ \t]*>[ \t]?)*/, '')
    this.previousItemWidth = LIST_ITEM_MARKER.exec(this.previousContent)?.[0].length ?? 0
    this.indent = prefix.replace(/^(?:[ \t]*>[ \t]?)*/, '').length
    this.listAttribute = /[-*+.)]/.test(prefix) && (this.lineStart === 0 || this.previousContent.trim() === '' || this.activeListColumn !== undefined)
    if (this.activeListColumn !== undefined && line.trim() !== '' && this.indent < this.activeListColumn && !this.listAttribute) {
      this.previousItemWidth = this.activeListColumn
      this.activeListColumn = undefined
    }
    if (this.listAttribute) this.activeListColumn = this.indent
  }
}

/** Reads every attribute run and blanks it out of `mask`. */
function scanDjotAttributes(source: string, mask: string[]): AttributeScan {
  const readAttributes = nativeAttributeReader(source)
  const scan: AttributeScan = { attributes: new Map(), emptyBlockAttributes: new Set(), listBoundaryComments: new Map() }
  const line = new AttributeLineTracker(source)
  for (let i = 0; i < source.length; i++) {
    if (mask[i] !== '{') continue
    line.advanceTo(i)
    const first = readAttributes(i)
    if (!first) continue
    let attrs = readAttributeRun(source, readAttributes, first)
    if (i === line.prefixEnd && attrs.end !== first.end) attrs = { ...attrs, source: '{%%}' }
    scan.attributes.set(i, attrs)
    if (attrs.source === '{}' && attrs.end === first.end && i === line.prefixEnd &&
        /^[ \t]*$/.test(source.slice(attrs.end, line.lineEnd)) && line.standsAlone()) {
      scan.emptyBlockAttributes.add(i)
      if (line.indent < line.previousItemWidth) scan.listBoundaryComments.set(i, '%%%\n' + source.slice(line.lineStart, line.prefixEnd) + '%%%')
    }
    for (let at = i; at < attrs.end; at++) if (mask[at] !== '\n') mask[at] = ' '
    i = attrs.end - 1
  }
  return scan
}

/** Merges attribute blocks written back to back into one run. */
function readAttributeRun(source: string, readAttributes: ReturnType<typeof nativeAttributeReader>, first: DjotAttributeRun): DjotAttributeRun {
  if (source[first.end] !== '{') return first
  const tokens = first.tokens.slice()
  const sources = first.source === '{}' ? [] : [first.source]
  let end = first.end
  while (source[end] === '{') {
    const next = readAttributes(end)
    if (!next) break
    for (const token of next.tokens) tokens.push(token)
    if (next.source !== '{}') sources.push(next.source)
    end = next.end
  }
  return end === first.end ? first : { tokens, end, source: sources.join('') || '{}' }
}

function scanBracedDelimiters(source: string, mask: string[], cells: Set<number>, paired?: Map<number, number>): BraceScan {
  const scan: BraceScan = { validBraces: new Set(), validBraceClosers: new Set(), braceEnds: new Map(), literalDashes: new Set() }
  const pending = new Map<string, number[]>()
  let lineStart = 0, lastEscaped = -1
  for (let i = 0; i < source.length; i++) {
    if (cells.has(i)) pending.clear()
    if (source[i] === '\n') {
      if (isQuotedBlank(source.slice(lineStart, i))) pending.clear()
      lineStart = i + 1
    }
    if (mask[i] !== source[i]) continue
    if (source[i] === '\\' && source[i + 1] !== '\n') { lastEscaped = i + 1; i++; continue }
    if (source[i] === '{' && BRACED_KINDS.includes(source[i + 1] ?? '\0')) {
      const kind = source[i + 1]!, stack = pending.get(kind) ?? []
      stack.push(i); pending.set(kind, stack)
    } else if (source[i] === '}' && i - 1 !== lastEscaped && BRACED_KINDS.includes(source[i - 1] ?? '\0')) {
      closeBracedDelimiter(scan, pending, source, mask, i, paired)
    }
  }
  return scan
}

function closeBracedDelimiter(scan: BraceScan, pending: Map<string, number[]>, source: string, mask: string[], i: number, paired?: Map<number, number>): void {
  const start = pending.get(source[i - 1]!)?.pop()
  if (start !== undefined && i > start + 2) {
    scan.validBraces.add(start); scan.validBraceClosers.add(i - 1); scan.braceEnds.set(start, i - 1)
    if (paired && '+-='.includes(source[start + 1]!)) paired.set(start + 1, i + 1)
    for (const stack of pending.values()) while (stack.at(-1) !== undefined && stack.at(-1)! > start) stack.pop()
    return
  }
  if (source[i - 1] !== '-') return
  let first = i - 1
  while (source[first - 1] === '-') first--
  if (i - first === 2) keepDashes(scan.literalDashes, source, mask, first, i)
  else if (i - first > 2) scan.literalDashes.add(i - 1)
}

function keepDashes(literalDashes: Set<number>, source: string, mask: string[], start: number, end: number): void {
  for (let at = start; at + 1 < end; at++) {
    if (source.startsWith('--', at) && mask[at] === '-' && mask[at + 1] === '-') {
      literalDashes.add(at)
      literalDashes.add(at + 1)
    }
  }
}

/** Pairs emphasis delimiters line by line, tracking the block context that resets open delimiters. */
class DelimiterPairer {
  private readonly delimiterKinds: string[]
  private readonly openers: Map<string, Opener[]>
  private readonly scan: DelimiterScan = { pairs: [], structural: new Set(), omittedQuoteBraces: new Set(), bracketPairs: [] }
  private readonly brackets: number[] = []
  private readonly openBraces: number[] = []
  private lineStart = 0
  private lineEnd: number
  private structuralEnd = 0
  private thematicLine = false
  private previousBlank = true
  private container = false
  private listColumn: number | undefined
  // A Djot table caption (`^ text` under a table, blank line allowed) carries
  // the same marker Carve uses, so its `^` must reach the output bare. Only a
  // line in the table's own marker column and quote depth can hold one.
  private tableColumn: number | undefined
  private tableQuoteDepth: number | undefined
  private captionLine = false

  constructor(
    private readonly source: string,
    private readonly mask: string[],
    private readonly cells: Set<number>,
    private readonly braces: BraceScan,
    private readonly omitQuoteDelimiters: boolean,
    private readonly paired?: Map<number, number>,
  ) {
    this.lineEnd = source.length
    this.delimiterKinds = ['_', '*', '~', '^', ...(omitQuoteDelimiters ? ["'", '"'] : [])]
    this.openers = new Map<string, Opener[]>(this.delimiterKinds.flatMap(kind => [kind, '{' + kind]).map(key => [key, []]))
  }

  run(): DelimiterScan {
    for (let i = 0; i < this.source.length; i++) {
      if (this.cells.has(i)) this.resetInline()
      if (i === this.lineStart) this.beginLine(i)
      i = this.step(i)
    }
    return this.scan
  }

  private clear(from: number): void {
    for (const stack of this.openers.values()) while (stack.at(-1) && stack.at(-1)!.start >= from) stack.pop()
  }

  private resetInline(): void {
    this.clear(0)
    this.brackets.length = 0
    this.openBraces.length = 0
  }

  private beginLine(i: number): void {
    const source = this.source
    const end = source.indexOf('\n', i)
    this.lineEnd = end < 0 ? source.length : end
    const rawLine = source.slice(i, this.lineEnd)
    this.structuralEnd = i + djotStructuralPrefixEnd(rawLine)
    this.trackTableCaption(rawLine, rawLine.slice(0, this.structuralEnd - i))
    this.thematicLine = /^(?:[ \t]*>)*[ \t]*(?:\*[ \t]*){3,}$/.test(rawLine)
    this.trackBlockContext(rawLine.replace(/^(?:[ \t]*>[ ]?)*/, ''))
  }

  private trackTableCaption(rawLine: string, prefix: string): void {
    const quoteDepth = (prefix.match(/>/g) ?? []).length
    this.captionLine = this.tableColumn !== undefined && prefix.length >= this.tableColumn && quoteDepth === this.tableQuoteDepth
    // A blank line leaves the table in scope, which is how a caption separated
    // from its table by one keeps binding to it.
    if (rawLine.slice(prefix.length).trim() === '') return
    const tableLine = this.source[this.structuralEnd] === '|' && this.mask[this.structuralEnd] === '|'
    this.tableColumn = tableLine ? prefix.length : undefined
    this.tableQuoteDepth = tableLine ? quoteDepth : undefined
  }

  private trackBlockContext(line: string): void {
    const indent = /^[ \t]*/.exec(line)![0].length
    if (line.trim() && this.listColumn !== undefined && indent < this.listColumn && !/^[ \t]*(?:[-*+] |[0-9]+[.)] )/.test(line))
      this.listColumn = undefined
    const marker = /^[ \t]*(?:[-*+][ \t]|[0-9]+[.)][ \t]|\|)/.test(line)
    if (marker && (this.previousBlank || this.container)) { this.clear(0); this.container = true }
    else if (this.previousBlank) this.container = this.listColumn !== undefined && indent >= this.listColumn
    if (marker && this.container) { const item = /^[ \t]*(?:[-*+]|[0-9]+[.)])[ \t]+/.exec(line); if (item) this.listColumn = item[0].length }
    if (CODE_FENCE_LINE.test(line) || (this.previousBlank || this.container) && /^[ \t]*(?::{3,})/.test(line) || /^[ \t]*#{1,6}[ \t]/.test(line)) this.clear(0)
    this.previousBlank = line.trim() === '' || BLOCK_RESET_LINE.test(line)
  }

  /** Handles the character at `i` and returns the last offset it consumed. */
  private step(i: number): number {
    const { source, mask, openBraces } = this
    const ch = source[i]!
    if (ch === '\n') {
      if (isQuotedBlank(source.slice(this.lineStart, i))) this.resetInline()
      this.lineStart = i + 1
      return i
    }
    if (ch === '\\' && source[i + 1] !== '\n') return i + 1
    if (mask[i] !== ch) return i
    if (ch === '{' && this.braces.validBraces.has(i) && !'_*'.includes(source[i + 1] ?? '\0')) { openBraces.push(i); return i }
    if (ch === '}' && !isDjotEscaped(source, i - 1) && openBraces.at(-1) !== undefined && source[i - 1] === source[openBraces.at(-1)! + 1]) { this.clear(openBraces.pop()!); return i }
    if (ch === '[') { this.brackets.push(i); return i }
    if (ch === ']') { this.closeBracket(i); return i }
    if (!this.delimiterKinds.includes(ch)) return i
    return this.structuralDelimiter(i, ch) ?? this.pairDelimiter(i, ch)
  }

  private closeBracket(i: number): void {
    const start = this.brackets.pop()
    if (start === undefined) return
    this.clear(start)
    this.scan.bracketPairs.push([start, i])
  }

  /** A caption `^` or a list/thematic `*` is block syntax, not emphasis. */
  private structuralDelimiter(i: number, ch: string): number | undefined {
    const source = this.source, structural = this.scan.structural
    if (ch === '^' && this.captionLine && i === this.structuralEnd && (i === this.lineStart || /[ \t]/.test(source[i - 1]!))
      && source[i + 1] !== undefined && /[ \t]/.test(source[i + 1]!)) {
      structural.add(i)
      return i
    }
    if (ch !== '*' || i > this.structuralEnd) return undefined
    if (this.thematicLine) {
      for (let at = i; at < this.lineEnd; at++) if (source[at] === '*') structural.add(at)
      return this.lineEnd - 1
    }
    if (!/[ \t]/.test(source[i + 1] ?? '')) return undefined
    structural.add(i)
    return i
  }

  private pairDelimiter(i: number, ch: string): number {
    const { source, mask } = this
    const forcedOpen = source[i - 1] === '{' && mask[i - 1] === '{' && !isDjotEscaped(source, i - 1)
    const forcedClose = source[i + 1] === '}'
    if (this.omitQuoteDelimiters && (ch === '"' || ch === "'")) {
      if (forcedOpen) this.scan.omittedQuoteBraces.add(i - 1)
      if (forcedClose && !forcedOpen) this.scan.omittedQuoteBraces.add(i + 1)
    }
    const canOpen = forcedOpen || (!forcedClose && source[i + 1] !== undefined && !/[ \t\r\n]/.test(source[i + 1]!) && (ch !== "'" || i === 0 || /[ \t\r\n"'\-(\[]/.test(source[i - 1]!)))
    const canClose = !forcedOpen && (forcedClose || (i > 0 && !/[ \t\r\n]/.test(source[i - 1]!)))
    const opener = this.openers.get((forcedClose ? '{' : '') + ch)!.at(-1)
    const openBrace = this.openBraces.at(-1)
    if (canClose && opener && opener.end < i && (!opener.forced || opener.start > (openBrace ?? -1) || opener.start === openBrace)) return this.closePair(opener, i, ch, forcedClose)
    if (canOpen) {
      this.openers.get((forcedOpen ? '{' : '') + ch)!.push({ start: i - (forcedOpen ? 1 : 0), end: i + 1, kind: ch, forced: forcedOpen })
      return i
    }
    return forcedClose ? i + 1 : i
  }

  private closePair(opener: Opener, i: number, ch: string, forcedClose: boolean): number {
    const { openBraces, braces } = this
    this.clear(opener.start)
    while (openBraces.at(-1) !== undefined && openBraces.at(-1)! > opener.start) {
      const start = openBraces.pop()!
      braces.validBraces.delete(start)
      braces.validBraceClosers.delete(braces.braceEnds.get(start)!)
      this.paired?.delete(start + 1)
    }
    this.scan.pairs.push({
      start: opener.start,
      openEnd: opener.end,
      close: i,
      end: i + (forcedClose ? 2 : 1),
      kind: ch,
      forced: opener.forced,
      children: [],
      kinds: new Set([ch]),
    })
    if (!forcedClose) return i
    if (openBraces.at(-1) === opener.start) openBraces.pop()
    return i + 1
  }
}

function addBracedHighlights(pairs: Pair[], source: string, braces: BraceScan): void {
  for (const start of braces.validBraces) {
    if (source[start + 1] !== '=') continue
    const close = braces.braceEnds.get(start)!
    pairs.push({ start, openEnd: start + 2, close, end: close + 2, kind: '=', forced: true, children: [], kinds: new Set(['=']) })
  }
}

/** Sorts `pairs` in place, nests them, and returns the roots. */
function nestPairs(pairs: Pair[]): Pair[] {
  pairs.sort((a, b) => a.start - b.start || b.end - a.end)
  const roots: Pair[] = []
  const stack: Pair[] = []
  for (const pair of pairs) {
    while (stack.at(-1) && pair.start >= stack.at(-1)!.end) stack.pop()
    const children = stack.at(-1)?.children ?? roots
    children.push(pair)
    stack.push(pair)
  }
  for (let i = pairs.length - 1; i >= 0; i--)
    for (const child of pairs[i]!.children) for (const kind of child.kinds) pairs[i]!.kinds.add(kind)
  return roots
}

/** Brackets that cross an emphasis boundary and braced openers that never paired stay literal. */
function literalBracketPositions(source: string, mask: string[], braces: BraceScan, delimiters: DelimiterScan, starts: Map<number, Pair>): Set<number> {
  const ends = new Map(delimiters.pairs.map((pair) => [pair.end, pair]))
  const contexts = new Map<number, Pair | undefined>()
  const active: Pair[] = []
  for (let i = 0; i <= source.length; i++) {
    if (ends.has(i)) active.pop()
    const pair = starts.get(i)
    if (pair) active.push(pair)
    if (source[i] === '[' || source[i] === ']') contexts.set(i, active.at(-1))
  }
  const literalBrackets = new Set<number>()
  for (const [start, end] of delimiters.bracketPairs) {
    if (contexts.get(start) !== contexts.get(end)) {
      literalBrackets.add(start)
      literalBrackets.add(end)
    }
  }
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue }
    if (mask[i] === '{' && BRACED_KINDS.includes(source[i + 1] ?? '\0') && !braces.validBraces.has(i) && !starts.has(i)) {
      if (i > 0 && source[i - 1] === '`' && mask[i - 1] === ' ' && RAW_ATTRIBUTE.test(source.slice(i))) continue
      literalBrackets.add(i)
      literalBrackets.add(i + 1)
    }
  }
  return literalBrackets
}

/** Records how many braced or bracketed hosts enclose each pair, for the nesting cap. */
function assignHostDepths(source: string, braces: BraceScan, bracketPairs: Array<[number, number]>, literalBrackets: Set<number>, starts: Map<number, Pair>): void {
  const hostChanges = new Map<number, number>()
  for (const start of braces.validBraces) {
    if (starts.has(start)) continue
    const end = braces.braceEnds.get(start)!
    hostChanges.set(start + 2, (hostChanges.get(start + 2) ?? 0) + 1)
    hostChanges.set(end, (hostChanges.get(end) ?? 0) - 1)
  }
  for (const [start, end] of bracketPairs) {
    if (literalBrackets.has(start) || literalBrackets.has(end)) continue
    if (!'([{'.includes(source[end + 1] ?? '\0') && source[start - 1] !== '^') continue
    hostChanges.set(start + 1, (hostChanges.get(start + 1) ?? 0) + 1)
    hostChanges.set(end, (hostChanges.get(end) ?? 0) - 1)
  }
  if (!hostChanges.size) return
  let hostDepth = 0
  for (let at = 0; at < source.length; at++) {
    hostDepth += hostChanges.get(at) ?? 0
    const pair = starts.get(at)
    if (pair) pair.hostDepth = hostDepth
  }
}

/** Writes pairs as Carve delimiters, protecting literal syntax behind placeholders until `convert` has run. */
class EmphasisRenderer {
  private readonly literalPrefix: string
  private readonly literals: string[] = []
  private readonly bracketCloses: Set<number>
  private readonly rendered = new Map<Pair, string>()

  constructor(
    private readonly source: string,
    private readonly mask: string[],
    private readonly attributes: AttributeScan,
    private readonly braces: BraceScan,
    private readonly delimiters: DelimiterScan,
    private readonly literalBrackets: Set<number>,
    private readonly options: EmphasisOptions,
  ) {
    this.literalPrefix = djotPlaceholderPrefix(source, '\0DJOTLITERAL\0')
    this.bracketCloses = new Set(delimiters.bracketPairs.map(([, close]) => close))
  }

  document(roots: Pair[], convert: (plain: string) => string): string {
    this.renderTree(roots)
    return convert(this.body(0, this.source.length, roots)).replace(
      new RegExp(`${this.literalPrefix}(\\d+)\0`, 'g'),
      (_match, index: string) => this.literals[Number(index)]!,
    )
  }

  private renderTree(roots: Pair[]): void {
    const work: Array<{ pair: Pair; outer: Set<string>; ready: boolean; depth: number }> = roots
      .map((pair) => ({ pair, outer: new Set<string>(), ready: false, depth: 0 }))
      .reverse()
    while (work.length) {
      const frame = work.pop()!
      if (frame.ready) {
        this.rendered.set(frame.pair, this.renderPair(frame.pair, frame.outer, frame.depth))
        continue
      }
      work.push({ ...frame, ready: true })
      const childScope = new Set([...frame.outer, frame.pair.kind])
      for (let i = frame.pair.children.length - 1; i >= 0; i--)
        work.push({ pair: frame.pair.children[i]!, outer: childScope, ready: false, depth: frame.depth + 1 })
    }
  }

  private protect(value: string): string {
    const token = `${this.literalPrefix}${this.literals.length}\0`
    this.literals.push(value)
    return token
  }

  private plain(start: number, end: number): string {
    const { source, mask, braces } = this
    let text = ''
    for (let i = start; i < end; i++) {
      const attrs = this.attributes.attributes.get(i)
      if (attrs && attrs.end <= end) {
        text += this.protect(this.attributeLiteral(i, attrs))
        i = attrs.end - 1
        continue
      }
      if (this.delimiters.omittedQuoteBraces.has(i)) continue
      const ch = source[i]!
      if (ch === '\\') { text += source.slice(i, Math.min(end, i + 2)); i++; continue }
      if (ch === '=' && (braces.validBraceClosers.has(i) || braces.validBraces.has(i - 1))) {
        text += this.protect(ch)
        continue
      }
      const structural = this.delimiters.structural.has(i)
      if (mask[i] === ch && ('~^_*'.includes(ch) && !structural || this.literalBrackets.has(i))) {
        text += this.protect(`\\${ch}`)
        continue
      }
      text += braces.literalDashes.has(i) ? '\\-' : ch
      // Carve opens a caption on `^ `, never on `^\t`, so a tab-separated Djot
      // caption needs the space the marker requires.
      if (ch === '^' && structural && source[i + 1] === '\t') { text += ' '; i++ }
    }
    return text
  }

  private attributeLiteral(i: number, attrs: DjotAttributeRun): string {
    if (attrs.source !== '{}') return attrs.source
    if (this.bracketCloses.has(i - 1) && !this.literalBrackets.has(i - 1)) return '{}'
    return this.attributes.listBoundaryComments.get(i) ?? (this.attributes.emptyBlockAttributes.has(i) ? '%%' : '{%%}')
  }

  private body(start: number, end: number, children: Pair[]): string {
    let text = '',
      cursor = start
    for (const child of children) {
      text += this.plain(cursor, child.start) + this.rendered.get(child)!
      cursor = child.end
    }
    return text + this.plain(cursor, end)
  }

  private renderPair(pair: Pair, outer: Set<string>, depth: number): string {
    if (depth + (pair.hostDepth ?? 0) >= MAX_NESTING_DEPTH - 1) {
      this.options.flattened?.(pair.start)
      return this.body(pair.openEnd, pair.close, pair.children)
    }
    const scope = outer.has(pair.kind) || pair.children.some((child) => child.kinds.has(pair.kind))
    const content = this.body(pair.openEnd, pair.close, pair.children)
    if (pair.kind === '"' || pair.kind === "'") return content
    // The opener would be part of a larger character (CARVE-P3-025).
    if (extendsGrapheme(content, 0)) {
      this.options.extenderLeading?.(pair.start)
      return content
    }
    const delimiter = pair.kind === '=' ? '=' : pair.kind === '_' ? '/' : pair.kind === '~' ? ',' : pair.kind === '^' ? '^' : '*'
    const forced = scope || this.needsBraces(pair, content, delimiter)
    return this.protect(forced ? `{${delimiter}` : delimiter) + content + this.protect(forced ? `${delimiter}}` : delimiter)
  }

  private needsBraces(pair: Pair, content: string, delimiter: string): boolean {
    const { source } = this
    // An empty attribute block writes a comment, which counts as nothing for a bare guard (carve#4719).
    const emptyBoundary = source.startsWith('{}', pair.end) ||
      (pair.start >= 2 && source.startsWith('{}', pair.start - 2) && !isDjotEscaped(source, pair.start - 2))
    return this.options.omitQuoteDelimiters || pair.kind === '~' || pair.kind === '^' || pair.forced ||
      extendsGrapheme(source, pair.end) ||
      emptyBoundary ||
      content.startsWith('\0') ||
      content.endsWith('\0') ||
      /[A-Za-z0-9_]/.test(source[pair.start - 1] ?? '') ||
      /[A-Za-z0-9_]/.test(source[pair.end] ?? '') ||
      /^[ \t\r\n]|[ \t\r\n]$/.test(content) ||
      content.startsWith(delimiter) ||
      content.endsWith(delimiter) ||
      // A bare slash beside a slash neither opens nor reads as one pair.
      (delimiter === '/' && (source[pair.start - 1] === '/' || source[pair.end] === '/')) ||
      (delimiter === '/' && content.startsWith('*') && content.endsWith('*'))
  }
}

function maskFootnotes(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      const end = line.lastIndexOf(']') + 1
      return line.slice(0, end).replace(/\[\^[^\]\n]*\]/g, (value) => ' '.repeat(value.length)) + line.slice(end)
    })
    .join('\n')
}

function maskDjotEmphasisSource(source: string, imageLabels = false): string {
  const masked = maskDjotCodeAndDestinations(source).split('')
  let offset = 0, rawFence: string | undefined
  for (const line of source.split('\n')) {
    if (rawFence) {
      for (let i = offset; i < offset + line.length; i++) masked[i] = ' '
      if (new RegExp(`^[ \t]*${rawFence[0]}{${rawFence.length},}[ \t]*$`).test(line)) rawFence = undefined
    } else {
      const open = /^[ \t]*(`{3,}|~{3,})[ \t]*=html[ \t]*$/.exec(line)
      if (open) {
        rawFence = open[1]!
        for (let i = offset; i < offset + line.length; i++) masked[i] = ' '
      }
    }
    offset += line.length + 1
  }
  const text = masked.join('')
  return imageLabels ? text : text.replace(/!\[[^\[\]\n]*\](?=[([])/g, (value: string, at: number) => isDjotEscaped(source, at) || isDjotEscaped(source, at + value.length - 1) ? value : ' '.repeat(value.length))
}
