// C2-W-088: a round escapes every potential opener of each kind its parse reports in a leaf block.
import { pushAll, pushReversed } from './arrays.ts'
import { childNodes, isBreak, isInlineParent } from './ast.ts'
import type { DivNode, Node, TextNode } from './ast-nodes.ts'
import { usesHardBreakOpener } from './write-blocks.ts'
import { BRACKETED, type Check, CLOSING_MARKS, contentClosers, escapeAt, isEscaped } from './write-check.ts'
import { BRACED_MARKS } from './inline-tables.ts'
import { escapeOffsets, IN_CELL } from './write-inline.ts'
import { isAsciiAlphanumeric, isBoundarySpace, isWordCharacter } from './unicode.ts'

/** One leaf of the inline content of a block: a text node, a break, or the markup of another inline node. */
type Leaf = { text: TextNode, lineStart: boolean }
  | { text: null, kind: 'break' | 'markup', dash?: boolean, mark?: string, backslash?: boolean }

interface KindBlock {
  leaves: Leaf[]
  /** The place of each text node in `leaves`. */
  places?: Map<TextNode, number>
}

/** C2-W-088: the text nodes of each block of `group`, in order, with the block that holds them. */
function kindBlocks(w: Check['w'], group: readonly Node[]): Map<TextNode, KindBlock> {
  const owners = new Map<TextNode, KindBlock>()
  const pending: [Node, boolean][] = group.map((node) => [node, false])
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    const [node, bareBreaks] = item
    if (isInlineParent(node)) {
      const block: KindBlock = { leaves: [] }
      flatten(childNodes(node), block.leaves, bareBreaks)
      block.places = new Map()
      block.leaves.forEach((leaf, index) => {
        if (leaf.text === null) return
        owners.set(leaf.text, block)
        block.places!.set(leaf.text, index)
      })
      continue
    }
    // C2-W-080: below a hard-break opener and in a line block a hard break is the bare line ending.
    const bare = bareBreaks || node.type === 'line_block' || (node.type === 'div' && usesHardBreakOpener(w, node as DivNode))
    for (const child of childNodes(node)) pending.push([child, bare])
  }
  return owners
}

const kindBlockCache = new WeakMap<Check['w'], { group: readonly Node[], owners: Map<TextNode, KindBlock> }>()

/** `kindBlocks` of a group, kept while the rounds of the same writer repair the same blocks. */
function groupKindBlocks(check: Check, group: readonly Node[]): Map<TextNode, KindBlock> {
  const known = kindBlockCache.get(check.w)
  if (known !== undefined && known.group.length === group.length && known.group.every((node, at) => node === group[at])) {
    return known.owners
  }
  const owners = kindBlocks(check.w, group)
  kindBlockCache.set(check.w, { group, owners })
  return owners
}

function flatten(nodes: readonly Node[], out: Leaf[], bareBreaks: boolean): void {
  for (const node of nodes) {
    if (node.type === 'text') {
      const before = out[out.length - 1]
      out.push({ text: node, lineStart: before === undefined || (before.text === null && before.kind === 'break') })
    } else if (isBreak(node)) out.push(breakLeaf(node, bareBreaks))
    else {
      // The source of a smart dash is hyphens that the written text joins (C2-W-099).
      const dash = node.type === 'smart_punctuation' && /^-+$/.test(node.source)
      out.push({ text: null, kind: 'markup', dash })
      flatten(childNodes(node), out, bareBreaks)
      // The closer of a paired node starts with its mark in either form, so a text brace before it reads as `{` and that mark.
      const mark = BRACKETED.has(node.type) ? undefined : CLOSING_MARKS.get(node.type)
      out.push(mark === undefined ? { text: null, kind: 'markup', dash } : { text: null, kind: 'markup', dash, mark })
    }
  }
}

/** C2-I-047: the backslash of a written hard break is no whitespace, so a delimiter before it can open. */
function breakLeaf(node: Node, bareBreaks: boolean): Leaf {
  return node.type === 'hard_break' && !bareBreaks ? { text: null, kind: 'break', backslash: true } : { text: null, kind: 'break' }
}

const SLASH = 0x2f
const STAR = 0x2a
const BACKSLASH = 0x5c

/**
 * The kind of the opener escaped at `at`, as a key: `L` and the shape for a line start, else the escaped character,
 * with the mark of a braced opener and `-` twice for the second hyphen of a run (C2-W-090, C2-W-099).
 */
function kindKey(block: KindBlock, index: number, at: number, line: boolean): string {
  const value = textOf(block, index)
  if (line) return `L${lineShape(value)}`
  const ch = value[at]!
  if (ch === '{' && at + 1 < value.length && BRACED_MARKS.includes(value[at + 1]!)) return `{${value[at + 1]}`
  // C2-W-088: a brace that ends its text reads as a braced opener with the mark of the markup behind it.
  if (ch === '{') return at + 1 < value.length ? '{' : `{${markBehind(block, index) ?? ''}`
  if (ch === '-' && (hyphenRun(block, index, at)[0] > 0 || (at === 0 && isDash(block.leaves[index - 1])) ||
    besideDash(block, index, at))) return '--'
  return ch
}

/** A lone hyphen of a text whose run goes on into a written dash beside it (C2-I-111). */
function besideDash(block: KindBlock, index: number, at: number): boolean {
  const value = textOf(block, index)
  if (value[at - 1] === '-' || value[at + 1] === '-') return false
  return (at === 0 && isDash(block.leaves[index - 1])) || (at === value.length - 1 && isDash(block.leaves[index + 1]))
}

function isDash(leaf: KindBlock['leaves'][number] | undefined): boolean {
  return leaf !== undefined && leaf.text === null && leaf.dash === true
}

/** The mark of the paired markup directly behind the text leaf `index`, or undefined. */
function markBehind(block: KindBlock, index: number): string | undefined {
  const next = block.leaves[index + 1]
  return next !== undefined && next.text === null ? next.mark : undefined
}

function textOf(block: KindBlock, index: number): string {
  return (block.leaves[index] as { text: TextNode }).text.value
}

/** The text leaf before or after `index` with nothing between them, or -1. */
function adjacentText(block: KindBlock, index: number, step: number): number {
  const leaf = block.leaves[index + step]
  return leaf !== undefined && leaf.text !== null ? index + step : -1
}

/**
 * The place of the hyphen at `at` in its run and the length of the run, where a run goes on over adjacent text
 * nodes, since the written text joins them (C2-W-099).
 */
function hyphenRun(block: KindBlock, index: number, at: number): [number, number] {
  const value = textOf(block, index)
  let start = at
  while (start > 0 && value[start - 1] === '-') start--
  let end = at + 1
  while (end < value.length && value[end] === '-') end++
  const before = start === 0 ? runOver(block, index, -1) : 0
  const after = end === value.length ? runOver(block, index, 1) : 0
  return [before + at - start, before + end - start + after]
}

/** The hyphens that the adjacent text nodes in direction `step` add to a run that reaches the edge of `index`. */
function runOver(block: KindBlock, index: number, step: number): number {
  let total = 0
  for (let leaf = adjacentText(block, index, step); leaf >= 0; leaf = adjacentText(block, leaf, step)) {
    const text = textOf(block, leaf)
    let run = 0
    while (run < text.length && text[step < 0 ? text.length - 1 - run : run] === '-') run++
    total += run
    if (run < text.length) break
  }
  return total
}

/** The shape of a line opener: its first character, or `0` and the delimiter for an ordered marker. */
function lineShape(value: string): string {
  const end = markerEnd(value)
  if (end > 0) return `0${value[end] ?? ''}`
  return value[0] ?? ''
}

function markerEnd(value: string): number {
  let end = 0
  while (end < value.length && isAsciiAlphanumeric(value.charCodeAt(end))) end++
  return end
}

/** The offset that makes the line opener of kind `key` text, where `leaf` starts a line of that shape. */
function lineOffsets(key: string, leaf: { text: TextNode, lineStart: boolean }): number[] {
  const value = leaf.text.value
  if (!leaf.lineStart || value === '' || `L${lineShape(value)}` !== key) return []
  if (key.startsWith('L0')) return [markerEnd(value)]
  return [value.startsWith('--') ? 1 : 0]
}

/**
 * C2-W-099: the second hyphen of each run, where a run goes on over adjacent text nodes, or the hyphen beside a
 * written dash. C2-W-088: a single hyphen is no potential opener of this kind.
 */
function hyphenOffsets(block: KindBlock, index: number): number[] {
  const value = textOf(block, index)
  const offsets: number[] = []
  for (let at = value.indexOf('-'); at >= 0; at = value.indexOf('-', at + 1)) {
    if (hyphenRun(block, index, at)[0] === 1 || besideDash(block, index, at)) offsets.push(at)
  }
  return offsets
}

/** The first character of each run of the kind, and of `/` and `*` each one that can open. */
function charOffsets(key: string, block: KindBlock, index: number, value: string): number[] {
  const offsets: number[] = []
  const ch = key.charCodeAt(0)
  const delimiter = ch === SLASH || ch === STAR
  for (let at = value.indexOf(key[0]!); at >= 0; at = value.indexOf(key[0]!, at + 1)) {
    if (key.length === 2 && (at + 1 < value.length ? value[at + 1] : markBehind(block, index)) !== key[1]) continue
    if (delimiter ? canOpen(block, index, at) : key.length > 1 && ch === 0x7b ? true : value.charCodeAt(at - 1) !== ch) offsets.push(at)
  }
  return offsets
}

/** The offsets of the openers of kind `key` in `value`, the text of a leaf of `block`. */
function kindOffsets(key: string, block: KindBlock, index: number): number[] {
  const leaf = block.leaves[index] as { text: TextNode, lineStart: boolean }
  if (key.startsWith('L')) return lineOffsets(key, leaf)
  if (key === '--') return hyphenOffsets(block, index)
  return charOffsets(key, block, index, leaf.text.value)
}

/** C2-I-047, C2-I-049: a delimiter whose neighbors let it open, by the characters written around it. */
function canOpen(block: KindBlock, index: number, at: number): boolean {
  const value = (block.leaves[index] as { text: TextNode }).text.value
  const ch = value.charCodeAt(at)
  const before = at > 0 ? value.codePointAt(at - 1 - (isLow(value, at - 1) ? 1 : 0))! : edge(block, index, -1)
  const after = at + 1 < value.length ? value.codePointAt(at + 1)! : edge(block, index, 1)
  if (before === ch || after === ch) return false
  return !isWordCharacter(before) && after !== -1 && !isBoundarySpace(after)
}

function isLow(value: string, at: number): boolean {
  const code = value.charCodeAt(at)
  return code >= 0xdc00 && code <= 0xdfff && at > 0
}

/** The character next to a leaf, where a text leaf stands there; -1 at a line edge, 0 beside other markup. */
function edge(block: KindBlock, index: number, step: number): number {
  const next = block.leaves[index + step]
  if (next !== undefined && next.text === null && next.backslash === true && step > 0) return BACKSLASH
  if (next === undefined || next.text === null) return next !== undefined && next.kind === 'markup' ? 0x21 : -1
  const value = next.text.value
  if (value === '') return 0x21
  return step < 0 ? value.codePointAt(value.length - 1 - (isLow(value, value.length - 1) ? 1 : 0))! : value.codePointAt(0)!
}

/**
 * Adds to the escapes of `check` every opener of each kind they report in their block, so the rounds are bounded by
 * the kinds, not by the escapes. A C2-W-125 trial, an escape among `noKind` or `lengthening` and a block opener inside
 * a line give no kind.
 */
export function escapeKinds(check: Check, group: readonly Node[], noKind: ReadonlySet<[TextNode, number]> = new Set(),
  starts?: TextStarts): void {
  const trials = new Set(check.trials)
  const candidates = check.escapes.filter((escape) => check.ownEscapes.get(escape[0])?.has(escape[1]) !== true &&
    !trials.has(escape) && !noKind.has(escape) && !check.lengthening.has(escape))
  const braces = candidates.some(([node, at]) => node.value[at] === '{') ? braceContext(check, group, starts) : null
  const reported = candidates.filter(([node, at]) => reportedBrace(braces, node, at))
  if (reported.length === 0) return
  const owners = groupKindBlocks(check, group)
  const done = new Map<KindBlock, Set<string>>()
  for (const [node, at] of reported) {
    const block = owners.get(node)
    if (block === undefined) continue
    const key = reportedKey(check, block, node, at, braces)
    if (key.startsWith('{')) check.w.reportedBraceKinds.add(key)
    const keys = done.get(block) ?? new Set<string>()
    if (keys.has(key)) continue
    done.set(block, keys.add(key))
    block.leaves.forEach((leaf, index) => {
      if (leaf.text === null) return
      for (const offset of kindOffsets(key, block, index)) escapeAt(check, leaf.text, offset)
    })
  }
}

function reportedKey(check: Check, block: KindBlock, node: TextNode, at: number, braces: BraceContext | null): string {
  const index = block.places?.get(node) ?? -1
  const inline = commentKind(braces, node, at) ?? kindKey(block, index, at, false)
  const line = check.lineEscapes.get(node)?.has(at) === true ||
    (at === 0 && (block.leaves[index] as { lineStart?: boolean })?.lineStart === true && inline === '{')
  return line ? kindKey(block, index, at, true) : inline
}

interface BraceContext {
  bytes: Uint32Array
  ranges: [number, number][]
  starts: Map<TextNode, [number, readonly number[]]>
  /** The byte offsets where the parse holds a braced comment, `{%` or `{#`. */
  comments: Set<number>
}

/** Locate each written text leaf and each parsed text range once for the round. */
function braceContext(check: Check, group: readonly Node[], located?: TextStarts): BraceContext | null {
  const source = check.source
  const parsed = check.w.parsed
  if (source === null || parsed === null) return null
  const comments = new Set<number>()
  const { bytes, starts } = located ?? locateTexts(check, group, source)
  return { bytes, ranges: parsedTextRanges(parsed.children, comments), starts, comments }
}

/** Where each text leaf of a group stands in its written source, with the byte offset of each UTF-16 unit. */
export interface TextStarts {
  bytes: Uint32Array
  starts: Map<TextNode, [number, readonly number[]]>
}

export function writtenTextStarts(check: Check, group: readonly Node[], source: string): Map<TextNode, [number, readonly number[]]> {
  return locateTexts(check, group, source).starts
}

export function locateTexts(check: Check, group: readonly Node[], source: string): TextStarts {
  const starts = new Map<TextNode, [number, readonly number[]]>()
  const bytes = byteOffsets(source)
  const inert = inertRanges(check.w.parsed?.children ?? [])
  const pending = [...group].reverse().map(node => ({ node, inCell: false }))
  let cursor = 0
  for (let entry = pending.pop(); entry !== undefined; entry = pending.pop()) {
    const { node } = entry
    if (node.type !== 'text') {
      pushReversed(pending, childNodes(node).map(child => ({ node: child, inCell: entry.inCell || node.type === 'table_cell' })))
      continue
    }
    const escapes = escapeOffsets(check.w, node, entry.inCell ? IN_CELL : 0)
    let written = ''
    let from = 0
    let last = -1
    for (const at of escapes) {
      if (at <= last || at >= node.value.length) break
      written += node.value.slice(from, at) + '\\'
      from = last = at
    }
    written += node.value.slice(from)
    let start = nextTextPlace(source, written, cursor, bytes, inert)
    let length = written.length
    if (start < 0) { start = nextTextPlace(source, node.value, cursor, bytes, inert); length = node.value.length }
    if (start < 0) continue
    starts.set(node, [start, escapes])
    cursor = start + length
  }
  return { bytes, starts }
}

/** Text in a code, literal, or math span cannot be the source of a text leaf. */
function inertRanges(nodes: readonly Node[]): [number, number][] {
  const ranges: [number, number][] = []
  const pending = [...nodes]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if ((node.type === 'code' || node.type === 'literal_inline' || node.type === 'math') && node.pos !== undefined) {
      ranges.push([node.pos.startOffset, node.pos.endOffset])
    } else pushAll(pending, childNodes(node))
  }
  ranges.sort((a, b) => a[0] - b[0])
  return ranges
}

function nextTextPlace(source: string, value: string, cursor: number, bytes: Uint32Array, inert: readonly [number, number][]): number {
  if (value === '') return cursor
  for (let start = source.indexOf(value, cursor); start >= 0; start = source.indexOf(value, start + 1)) {
    const byte = bytes[start]!
    let low = 0
    let high = inert.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (inert[middle]![0] <= byte) low = middle + 1
      else high = middle
    }
    if (low === 0 || byte >= inert[low - 1]![1]) return start
  }
  return -1
}

function parsedTextRanges(nodes: readonly Node[], comments: Set<number>): [number, number][] {
  const ranges: [number, number][] = []
  const parsedNodes: Node[] = [...nodes]
  for (let node = parsedNodes.pop(); node !== undefined; node = parsedNodes.pop()) {
    if (node.type === 'text' && node.pos !== undefined) ranges.push([node.pos.startOffset, node.pos.endOffset])
    if ((node.type === 'critic_comment' || (node.type === 'comment' && node.form === 'braced')) && node.pos !== undefined) {
      comments.add(node.pos.startOffset)
    }
    pushAll(parsedNodes, childNodes(node))
  }
  ranges.sort((a, b) => a[0] - b[0])
  return ranges
}

function byteOffsets(source: string): Uint32Array {
  const bytes = new Uint32Array(source.length + 1)
  for (let at = 0, byte = 0; at < source.length; at++) {
    bytes[at] = byte
    const code = source.codePointAt(at)!
    byte += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
    if (code > 0xffff) { at++; bytes[at] = byte - 4 }
    bytes[at + 1] = byte
  }
  return bytes
}

/** A brace still held by parsed text is a case repair, not a reported construct. */
function reportedBrace(context: BraceContext | null, text: TextNode, at: number): boolean {
  const byte = text.value[at] === '{' ? braceByte(context, text, at) : undefined
  if (byte === undefined || context === null) return true
  let low = 0
  let high = context.ranges.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (context.ranges[middle]![0] <= byte) low = middle + 1
    else high = middle
  }
  return low === 0 || byte >= context.ranges[low - 1]![1]
}

/** The byte offset in the parsed source of the text brace at `at`, where the round located its text. */
function braceByte(context: BraceContext | null, text: TextNode, at: number): number | undefined {
  const located = context?.starts.get(text)
  if (located === undefined) return undefined
  const [start, escapes] = located
  let before = 0
  while (escapes[before] !== undefined && escapes[before]! < at) before++
  return context!.bytes[start + at + before]
}

/**
 * C2-W-088: a braced comment that the parse holds reports its opener with the mark behind the brace, `{%` or `{#`.
 * The same brace before an attribute block reports `{` (carve#6559), so the kind comes from the parse, not the text.
 */
function commentKind(context: BraceContext | null, text: TextNode, at: number): string | undefined {
  const mark = text.value[at + 1]
  if (text.value[at] !== '{' || (mark !== '%' && mark !== '#')) return undefined
  const byte = braceByte(context, text, at)
  return byte !== undefined && context!.comments.has(byte) ? `{${mark}` : undefined
}

/**
 * C2-W-125, case five: a `[` that is escaped in the content of a bracketed node leaves the `]` that closes it in
 * the text bare, which would end that node early; that `]` takes its backslash in the same round.
 */
export function escapePartnerClosers(check: Check, group: readonly Node[]): void {
  const pending = [...group]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (!BRACKETED.has(node.type)) {
      for (const child of childNodes(node)) pending.push(child)
      continue
    }
    for (const [text, at, partner] of contentClosers(childNodes(node), () => true, pending)) {
      if (partner !== null && isEscaped(check, partner[0], partner[1])) escapeAt(check, text, at)
    }
  }
}

// The first characters of the block line shapes of data/line-shapes.json; digits and letters start ordered markers.
const LINE_FIRST = '!#$%*+-.:=>[^`{|'

function isLineOpener(leaf: { text: TextNode, lineStart: boolean }, at: number): boolean {
  if (!leaf.lineStart) return false
  const value = leaf.text.value
  if (!isAsciiAlphanumeric(value.charCodeAt(0)) && !LINE_FIRST.includes(value[0] ?? '')) return false
  return kindOffsets(`L${lineShape(value)}`, { leaves: [leaf] }, 0).includes(at)
}

/** The kinds of the escapes `escapes` in `block`; without the parse a line-start escape may be of either kind. */
function planKinds(block: KindBlock, escapes: ReadonlyMap<TextNode, readonly number[]>): Set<string> {
  const keys = new Set<string>()
  block.leaves.forEach((leaf, index) => {
    if (leaf.text === null) return
    for (const at of escapes.get(leaf.text) ?? []) {
      const line = isLineOpener(leaf, at)
      const inline = kindKey(block, index, at, false)
      if (!line || inline !== '{') keys.add(inline)
      if (line) keys.add(kindKey(block, index, at, true))
    }
  })
  return keys
}

function bareOpener(block: KindBlock, key: string, placed: ReadonlyMap<TextNode, readonly number[]>): boolean {
  return block.leaves.some((leaf, index) => {
    if (leaf.text === null) return false
    // A set: a leaf can hold one escape per character, and a lookup in the list per opener is quadratic.
    const there = new Set(placed.get(leaf.text) ?? [])
    return kindOffsets(key, block, index).some((offset) => !there.has(offset))
  })
}

/** Whether the escapes `escapes` of a plan leave an opener of one of their kinds outside `placed` (C2-W-010). */
export function leavesKindBare(w: Check['w'], group: readonly Node[], escapes: ReadonlyMap<TextNode, readonly number[]>,
  placed: ReadonlyMap<TextNode, readonly number[]>): boolean {
  for (const block of new Set(kindBlocks(w, group).values())) {
    for (const key of planKinds(block, escapes)) if (bareOpener(block, key, placed)) return true
  }
  return false
}
