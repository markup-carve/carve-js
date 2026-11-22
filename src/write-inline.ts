// The inline nodes as Carve source (C2-W-069 to C2-W-080, C2-W-116). A line break of the
// content is a line feed in the string; the block that holds the content places the lines.
import {
  type AutolinkNode, childNodes, type CitationGroupNode, type CommentNode, type ImageNode, type Inline, type InlineParent, type LinkNode,
  type MentionNode, type Node, type NodeOfType, type ParagraphNode, type RubyNode, type TextNode, type InlineExtensionNode,
} from './ast.ts'
import { treesEqual } from './ast-json.ts'
import { foldLabel } from './ast-attributes.ts'
import { inlineContent } from './ast-blocks.ts'
import { parseChunk } from './write-check.ts'
import { unitBytes } from './positions.ts'
import { isAsciiPunctuation } from './unicode.ts'
import { braceBlock, quoted } from './write-attributes.ts'
import { lose, trimEnd, type Writer } from './write-state.ts'

/** The content stands in a table cell: a pipe in text takes a backslash (C2-W-098). */
export const IN_CELL = 1
export const IN_EMPHASIS = 2
export const IN_STRONG = 4
/** C2-W-080: a hard break is the bare line ending. */
export const BARE_BREAKS = 8
export const IN_BRACKET = 16
/** C2-W-117: a block written inside the body of a figure group, which a nested figure group cannot be. */
export const IN_FIGURE_GROUP = 32
/** C2-I-089: inside an inline footnote, where a caret pair opens nothing. */
export const IN_NOTE = 64

const BACKSLASH = 92
const EXCLAMATION = 33
const PIPE = 124
const SPACE = 32
const TAB = 9
const BACKTICK = 96
const BRACE = 123

/** A writer per inline node type, each of which reads a node of its own type. */
type InlineWriters = { [T in keyof NodeOfType]?: (w: Writer, node: NodeOfType[T], flags: number) => string }

type InlineWriter = (w: Writer, node: InlineParent, flags: number) => string

interface BraceQuoteCursor {
  at: number
  brace: boolean
  quote: number
}

/** C2-W-097: a backslash that the next character of the same text would make an escape is written twice. */
function doubles(value: string, at: number, cursor: BraceQuoteCursor): boolean {
  if (at + 1 >= value.length) return false
  const next = value.charCodeAt(at + 1)
  return (next === SPACE || isAsciiPunctuation(next)) && !inQuotedBrace(value, at, cursor)
}

/** C2-I-033: a quoted brace value is opaque, including its backslashes. */
function inQuotedBrace(value: string, at: number, cursor: BraceQuoteCursor): boolean {
  while (cursor.at < at) {
    const code = value.charCodeAt(cursor.at)
    if (cursor.quote !== 0) {
      if (code === BACKSLASH) {
        cursor.at += 2
        continue
      }
      if (code === cursor.quote) cursor.quote = 0
    } else if (code === 123) cursor.brace = true
    else if (code === 125) cursor.brace = false
    else if (cursor.brace && (code === 34 || code === 39)) cursor.quote = code
    cursor.at++
  }
  return cursor.quote !== 0
}

/** Whether the character `at` of a text takes a backslash whatever the reparse finds: C2-W-097, C2-W-098. */
function alwaysEscaped(value: string, at: number, flags: number, cursor: BraceQuoteCursor): boolean {
  const code = value.charCodeAt(at)
  return (code === BACKSLASH && doubles(value, at, cursor)) || ((flags & IN_CELL) !== 0 && code === PIPE)
}

/** Whether a character of `value` can take a backslash by `alwaysEscaped`. */
function mayAlwaysEscape(value: string, flags: number): boolean {
  return value.includes('\\') || ((flags & IN_CELL) !== 0 && value.includes('|'))
}

/** The asked offsets the scan below reaches: it stops at a repeated offset, as `escaped` does, and at the end of the value. */
function askedPrefix(escapes: readonly number[], length: number): readonly number[] {
  for (let index = 0; index < escapes.length; index++) {
    const at = escapes[index]!
    if (at >= length || (index > 0 && at <= escapes[index - 1]!)) return escapes.slice(0, index)
  }
  return escapes
}

/** The offsets of `node` that take a backslash: those asked for and those of C2-W-097, C2-W-098. */
export function escapeOffsets(w: Writer, node: TextNode, flags: number): readonly number[] {
  const value = node.value
  const escapes = w.escapes.get(node) ?? []
  if (!mayAlwaysEscape(value, flags)) return askedPrefix(escapes, value.length)
  const out: number[] = []
  let next = 0
  const cursor: BraceQuoteCursor = { at: 0, brace: false, quote: 0 }
  for (let at = 0; at < value.length; at++) {
    const asked = next < escapes.length && escapes[next] === at
    if (asked) next++
    if (asked || alwaysEscaped(value, at, flags, cursor)) out.push(at)
  }
  return out
}

/** The text `value[from, to)` with the backslashes it needs. */
function escaped(w: Writer, node: TextNode, value: string, from: number, to: number, flags: number): string {
  const escapes = w.escapes.get(node) ?? []
  if (!mayAlwaysEscape(value, flags)) {
    let out = ''
    let start = from
    let previous = -1
    for (let index = firstFrom(escapes, from); index < escapes.length && escapes[index]! < to; index++) {
      const at = escapes[index]!
      if (at === previous) break
      out += `${value.slice(start, at)}\\`
      start = at
      previous = at
    }
    return out + value.slice(start, to)
  }
  let out = ''
  let next = firstFrom(escapes, from)
  let start = from
  const cursor: BraceQuoteCursor = { at: 0, brace: false, quote: 0 }
  for (let at = from; at < to; at++) {
    const asked = next < escapes.length && escapes[next] === at
    if (asked) next++
    if (!asked && !alwaysEscaped(value, at, flags, cursor)) continue
    out += `${value.slice(start, at)}\\`
    start = at
  }
  return out + value.slice(start, to)
}

/** The index of the first entry of the ascending list `offsets` that is not below `from`. */
export function firstFrom(offsets: readonly number[], from: number): number {
  let low = 0
  let high = offsets.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (offsets[middle]! < from) low = middle + 1
    else high = middle
  }
  return low
}

/**
 * The offset in the value of the text `node` behind the `bytes` UTF-8 bytes of its spelling that
 * start at the offset `from`, or -1 where no character of the value ends there.
 */
export function spelledEnd(w: Writer, node: TextNode, from: number, bytes: number, flags: number): number {
  const value = node.value
  const escapes = w.escapes.get(node) ?? []
  let next = firstFrom(escapes, from)
  let rest = bytes
  let at = from
  const cursor: BraceQuoteCursor = { at: 0, brace: false, quote: 0 }
  for (; rest > 0 && at < value.length; at++) {
    const asked = next < escapes.length && escapes[next] === at
    if (asked) next++
    rest -= unitBytes(value, at) + (asked || alwaysEscaped(value, at, flags, cursor) ? 1 : 0)
  }
  return rest === 0 ? at : -1
}

function textNode(w: Writer, node: TextNode, flags: number): string {
  const value = node.value
  const points = (flags & IN_CELL) !== 0 ? w.wrapPoints?.get(node) : undefined
  if (points === undefined && !w.escapes.has(node) && !mayAlwaysEscape(value, flags)) return value
  let out = ''
  let from = 0
  for (const point of points ?? []) {
    // C2-L-021: the joining space before the fragment is the line break of the continuation row.
    out += `${escaped(w, node, value, from, Math.max(from, point - 1), flags)}\n`
    from = point
  }
  return out + escaped(w, node, value, from, value.length, flags)
}

/**
 * C2-I-023, C2-I-024: a line comment that starts the content of a span or ends before its closer does so only in the
 * braced form, whose opener is a content start and whose closer ends the comment.
 */
export function edgeComment(node: InlineParent): boolean {
  const first = node.children[0]
  const last = node.children[node.children.length - 1]
  return (first?.type === 'comment' && first.form === 'line') || (last?.type === 'comment' && last.form === 'line')
}

/** Whether emphasis (bit 1) and strong (bit 2) occur below `node` (C2-W-070). */
export function kindsBelow(w: Writer, node: Node): number {
  const known = w.kindsBelow.get(node)
  if (known !== undefined) return known
  let kinds = 0
  for (const child of childNodes(node)) {
    if (child.type === 'emphasis') kinds |= 1
    else if (child.type === 'strong') kinds |= 2
    if ('children' in child) kinds |= kindsBelow(w, child)
  }
  w.kindsBelow.set(node, kinds)
  return kinds
}

/** C2-W-116: a node that needs content and has none is left out. */
function contentOf(w: Writer, node: InlineParent, flags: number): string | null {
  if (node.children.length > 0) return writeInlines(w, node.children, flags)
  lose(w, node, null)
  return null
}

/** C2-W-069, C2-W-070: emphasis and strong, bare where that reads back and braced otherwise. */
function paired(mark: string, bit: number, inside: number): InlineWriter {
  return (w, node, flags) => {
    const content = contentOf(w, node, flags | inside)
    if (content === null) return ''
    const braced = bracedPair(w, node, flags, bit, inside)
    return braced ? `{${mark}${content}${mark}}` : `${mark}${content}${mark}`
  }
}

function bracedPair(w: Writer, node: InlineParent, flags: number, bit: number, inside: number): boolean {
  return (flags & inside) !== 0 || (kindsBelow(w, node) & bit) !== 0 || (w.forms.get(node) ?? 0) > 0 || edgeComment(node)
}

/** C2-W-071, C2-W-116: a span that has only a braced form. */
function braced(open: string, close: string): InlineWriter {
  return (w, node, flags) => {
    const content = contentOf(w, node, flags)
    return content === null ? '' : `{${open}${content}${close}}`
  }
}

/** The lengths of the runs of `code` in `value`, as the indexes that are set. */
function runLengths(value: string, code: number): number[] {
  const lengths: number[] = []
  let run = 0
  for (let at = 0; at <= value.length; at++) {
    if (at < value.length && value.charCodeAt(at) === code) run++
    else {
      if (run > 0) lengths[run] = 1
      run = 0
    }
  }
  return lengths
}

/** C2-I-016: whether a reader would take one space from each end of `value`. */
function losesPadding(value: string): boolean {
  if (!value.startsWith(' ') || !value.endsWith(' ')) return false
  for (let at = 0; at < value.length; at++) if (value.charCodeAt(at) !== SPACE) return true
  return false
}

/** C2-W-059: a braced comment, written `{%%}` when its value is empty. */
export function bracedComment(value: string): string {
  return value === '' ? '{%%}' : `{% ${value} %}`
}

/** C2-W-077: the shortest backtick run that does not occur in `value`, with padding where the ends need it. */
export function codeSpan(value: string): string {
  const taken = runLengths(value, BACKTICK)
  let length = 1
  while (taken[length] !== undefined) length++
  const run = '`'.repeat(length)
  const padded = value.startsWith('`') || value.endsWith('`') || losesPadding(value)
  return padded ? `${run} ${value} ${run}` : `${run}${value}${run}`
}

/**
 * C2-W-077, C2-W-117: a value that starts with a line break and ends with a backtick loses the pad before the line
 * break (C2-I-002), so it has no spelling; the padded form is written and reported.
 */
function spanValue(w: Writer, node: Node, value: string, flags: number): string {
  const spelled = cellValue(w, node, value, flags)
  if (spelled.startsWith('\n') && spelled.endsWith('`')) lose(w, node, 'value')
  return codeSpan(spelled)
}

/**
 * C2-W-067, C2-I-120: no form crosses a row of a pipe table, so a value with a line feed has no spelling in a cell;
 * a space stands in place of each line feed, and the loss is reported (C2-W-117).
 */
function cellValue(w: Writer, node: Node, value: string, flags: number): string {
  if ((flags & IN_CELL) === 0 || !value.includes('\n')) return value
  lose(w, node, 'value')
  return value.replaceAll('\n', ' ')
}

/** C2-I-013: a destination reads only the escaped parenthesis and the escaped backslash; C2-W-098: in a cell a pipe too. */
function destination(value: string, pipes: boolean): string {
  return /[()\\]/u.test(value) || (pipes && value.includes('|')) ? escapedDestination(value, pipes) : value
}

function escapedDestination(value: string, pipes: boolean): string {
  const unmatched = new Set<number>()
  const open: number[] = []
  for (let at = 0; at < value.length; at++) {
    if (value[at] === '(') open.push(at)
    else if (value[at] === ')' && open.pop() === undefined) unmatched.add(at)
  }
  for (const at of open) unmatched.add(at)
  let out = ''
  for (let at = 0; at < value.length; at++) {
    const char = value[at]!
    const next = at + 1 < value.length ? value[at + 1]! : ')'
    if (unmatched.has(at) || (char === '\\' && '()\\'.includes(next)) || (pipes && char === '|')) out += '\\'
    out += char
  }
  return out
}

/** C2-W-075: the label of a reference, from the tree. */
function referenceLabel(node: LinkNode | ImageNode, key: string, pipes: boolean): string {
  if (node.refForm === 'collapsed') return '[]'
  if (node.refForm === 'shortcut') return ''
  const label = pipes ? escapePipes(key) : key
  // C2-I-078: a label that starts with a caret or an at-sign is no reference label; the space folds away.
  return key.startsWith('^') || key.startsWith('@') ? `[ ${labelText(label)}]` : `[${labelText(label)}]`
}

/** C2-W-098: in a table cell every pipe is written with a backslash (C2-B-169). */
function escapePipes(value: string): string {
  return value.includes('|') ? value.replaceAll('|', '\\|') : value
}

/** C2-I-076, C2-I-079: a backslash at the end of a label would take its closing bracket; a space behind it folds away. */
function labelText(key: string): string {
  return key.endsWith('\\') ? `${key} ` : key
}

/** C2-W-073, C2-W-074: the link tail, or the label of a reference. */
export function target(node: LinkNode | ImageNode, href: string | undefined, pipes = false): string {
  const key = node.key
  if (key !== undefined) return referenceLabel(node, key, pipes)
  const tooltip = node.tooltip
  // C2-I-069: a link tail occupies one line. Keep the link when only its title cannot be spelled.
  const title = tooltip === undefined ? '' : ` ${quoted(tooltip.replace(/\r\n?|\n/gu, ' '), pipes)}`
  return `(${destination(href ?? '', pipes)}${title})`
}

/** C2-W-075, C2-W-084: the verbatim text of a reference, where the sidecar holds it and the reparse did not refuse it. */
export function rawReference(w: Writer, node: LinkNode | ImageNode, flags: number): string | null {
  if (node.key === undefined || (w.forms.get(node) ?? 0) > 0) return null
  const raw = w.facts?.get(node)?.rawRef
  if (raw === undefined) return null
  if (!raw.includes('\n')) return raw
  // C2-W-067: a break inside a label of a cell is not kept; the label folds it to a space (C2-I-079).
  if ((flags & IN_CELL) !== 0) return raw.replaceAll(/[ \t]*\n[ \t]*/g, ' ')
  return trimLineEnds(raw)
}

/** C2-W-022: no space or tab stands at the end of a line, except a space that an odd run of backslashes escapes (C2-I-002). */
function trimLineEnds(raw: string): string {
  let out = ''
  let from = 0
  for (let end = raw.indexOf('\n'); end >= 0; end = raw.indexOf('\n', end + 1)) {
    let cut = end
    while (cut > from && (raw[cut - 1] === ' ' || raw[cut - 1] === '\t')) cut--
    let slashes = 0
    while (cut - slashes > from && raw[cut - 1 - slashes] === '\\') slashes++
    if (slashes % 2 === 1 && raw[cut] === ' ') cut++
    out += `${raw.slice(from, cut)}\n`
    from = end + 1
  }
  return out + raw.slice(from)
}

/** C2-W-125 case five: an unescaped leading caret of link or span text reads as a footnote reference instead. */
function escapeLeadingCaret(w: Writer, children: readonly Inline[], flags: number): void {
  const first = children[0]
  if ((flags & IN_NOTE) !== 0) return
  if (first?.type === 'text' && first.value.startsWith('^')) {
    const escapes = w.escapes.get(first) ?? []
    if (escapes[0] !== 0) w.escapes.set(first, [0, ...escapes])
  }
}

type BracketPlace = { node: TextNode, at: number }

/**
 * The open brackets of a link's text, bottom first, and its lone closers. The brackets of a nested link stand as
 * counts, a run of them as one number, so that a scan of a deep nest of links takes one step per run, not per bracket.
 */
interface BracketScan { open: (BracketPlace | number)[], size: number, lone: BracketPlace[], loneCount: number }

function popBrackets(scan: BracketScan, count: number): void {
  let left = Math.min(count, scan.size)
  scan.size -= left
  while (left > 0) {
    const top = scan.open[scan.open.length - 1]!
    if (typeof top !== 'number' || top <= left) {
      scan.open.pop()
      left -= typeof top === 'number' ? top : 1
    } else {
      scan.open[scan.open.length - 1] = top - left
      left = 0
    }
  }
}

function textBracketPlaces(node: TextNode, scan: BracketScan): void {
  for (let at = 0; at < node.value.length; at++) {
    if (node.value[at] === '[') {
      scan.open.push({ node, at })
      scan.size++
    } else if (node.value[at] === ']') {
      if (scan.size > 0) popBrackets(scan, 1)
      else {
        scan.lone.push({ node, at })
        scan.loneCount++
      }
    }
  }
}

/** The brackets of a link's text that have no partner there: closers first, then openers (C2-W-125 case five). */
interface BracketCounts { closers: number, openers: number }
const linkBrackets = new WeakMap<Writer, Map<LinkNode, BracketCounts>>()

/**
 * A bracket paired inside a nested link stays paired in every link around it, and the nested link escapes its own
 * lone brackets when it is written, so the outer scan takes only its counts: one scan per link, not one per depth.
 */
function nestedLinkBrackets(w: Writer, node: LinkNode): BracketCounts {
  let cache = linkBrackets.get(w)
  if (cache === undefined) linkBrackets.set(w, cache = new Map<LinkNode, BracketCounts>())
  let counts = cache.get(node)
  if (counts === undefined) {
    const scan: BracketScan = { open: [], size: 0, lone: [], loneCount: 0 }
    loneLinkBrackets(w, node.children, scan)
    cache.set(node, counts = { closers: scan.loneCount, openers: scan.size })
  }
  return counts
}

function countedBrackets({ closers, openers }: BracketCounts, scan: BracketScan): void {
  scan.loneCount += Math.max(0, closers - scan.size)
  popBrackets(scan, closers)
  if (openers === 0) return
  const top = scan.open[scan.open.length - 1]
  if (typeof top === 'number') scan.open[scan.open.length - 1] = top + openers
  else scan.open.push(openers)
  scan.size += openers
}

/** Collect brackets that have no partner among the text of this link label; those of a nested link are counts. */
function loneLinkBrackets(w: Writer, nodes: readonly Inline[], scan: BracketScan): void {
  for (const node of nodes) {
    if (node.type === 'text') textBracketPlaces(node, scan)
    else if (node.type === 'link') countedBrackets(nestedLinkBrackets(w, node), scan)
    else if ('children' in node && node.type !== 'citation_group') loneLinkBrackets(w, node.children, scan)
  }
}

/** Merge two ascending escape lists without lengthening a link's write beyond its text. */
function mergeLinkEscapes(escapes: readonly number[], positions: readonly number[]): number[] {
  const merged: number[] = []
  let prior = 0, next = 0
  while (prior < escapes.length || next < positions.length) {
    const at = next === positions.length || prior < escapes.length && escapes[prior]! < positions[next]!
      ? escapes[prior++]! : positions[next++]!
    if (merged.at(-1) !== at) merged.push(at)
  }
  return merged
}

/** C2-W-125 case five: a bracket without a partner in link text would take the link's own closer. */
function escapeLoneLinkBrackets(w: Writer, children: readonly Inline[]): void {
  const scan: BracketScan = { open: [], size: 0, lone: [], loneCount: 0 }
  loneLinkBrackets(w, children, scan)
  const byNode = new Map<TextNode, number[]>()
  for (const place of [...scan.lone, ...scan.open]) {
    if (typeof place === 'number') continue
    const positions = byNode.get(place.node) ?? []
    positions.push(place.at)
    byNode.set(place.node, positions)
  }
  for (const [node, positions] of byNode) {
    w.escapes.set(node, mergeLinkEscapes(w.escapes.get(node) ?? [], positions))
  }
}

function linkNode(w: Writer, node: LinkNode, flags: number): string {
  const raw = rawReference(w, node, flags)
  if (raw !== null) return raw
  escapeLeadingCaret(w, node.children, flags)
  escapeLoneLinkBrackets(w, node.children)
  if (node.key === undefined && /[\r\n]/u.test(node.tooltip ?? '')) lose(w, node, 'tooltip')
  const content = writeInlines(w, node.children, flags | IN_BRACKET)
  return `[${collapsedContent(node, content, flags)}]${target(node, node.href, (flags & IN_CELL) !== 0)}`
}

/**
 * C2-W-075: the content of a collapsed reference folds to its key (C2-I-079). Where the written content does not, and
 * the key read as content gives the children, the key is the content.
 */
function collapsedContent(node: LinkNode, content: string, flags: number): string {
  const key = node.key
  if ((node.refForm !== 'collapsed' && node.refForm !== 'shortcut') || key === undefined || (flags & IN_CELL) !== 0 ||
    foldLabel(content) === key) return content
  const children: ParagraphNode = { type: 'paragraph', children: node.children }
  return labelLike(content, key, (candidate) => readsAsCollapsed(candidate, key, children))
}

/** C2-W-075: the first spelling of the label `written` that folds to `key` and reads back, or `written`. */
function labelLike(written: string, key: string, readsBack: (candidate: string) => boolean): string {
  for (const candidate of [escapedLike(written, key), spacedLike(written, key), key]) {
    if (candidate !== null && readsBack(candidate)) return candidate
  }
  return written
}

/** Trap: the candidate is read inside its brackets, where an edge space stays and `%%` opens no comment. */
function readsAsCollapsed(candidate: string, key: string, children: ParagraphNode): boolean {
  const read = inlineContent(`[${candidate}][]`)
  const link = read.length === 1 ? read[0] : undefined
  return link?.type === 'link' && link.key === key && treesEqual({ type: 'paragraph', children: link.children }, children)
}

/**
 * C2-I-001, C2-I-079: the content with a backslash before each ASCII punctuation character that the key escapes and
 * none before one it holds bare, where the two differ in nothing else than those and the whitespace the fold
 * collapses; null otherwise.
 */
function escapedLike(content: string, key: string): string | null {
  let out = ''
  let at = 0
  let k = 0
  while (at < content.length) {
    const char = content[at]!
    if (isLabelSpace(char)) {
      const end = spaceRunEnd(content, at)
      out += content.slice(at, end)
      k = keyAfterSpace(key, k, end < content.length)
      at = end
      continue
    }
    if (dropsEscape(content, at, key, k)) {
      out += content[at + 1]!
      k++
      at += 2
      continue
    }
    const escape = keyEscapes(key, k, char)
    if (!escape && key[k] !== char) return null
    out += escape ? '\\' + char : char
    k += escape ? 2 : 1
    at++
  }
  return k === key.length && foldLabel(out) === key ? out : null
}

/**
 * C2-I-079: the key with each space replaced by the matching space run between the words of the content, so that a
 * line break of the content stays where a braced form of a node around it changed the label; null where the counts differ.
 */
function spacedLike(content: string, key: string): string | null {
  const runs: string[] = []
  let at = 0
  while (at < content.length && isLabelSpace(content[at]!)) at++
  while (at < content.length) {
    if (!isLabelSpace(content[at]!)) {
      at++
      continue
    }
    const end = spaceRunEnd(content, at)
    if (end < content.length) runs.push(content.slice(at, end))
    at = end
  }
  const words = key.split(' ')
  if (words.length !== runs.length + 1 || runs.every((run) => run === ' ')) return null
  return words.map((word, index) => (index === 0 ? word : runs[index - 1]! + word)).join('')
}

/** C2-I-079: the fold drops the space at the start and at the end of a label and makes one space of each run between. */
function keyAfterSpace(key: string, k: number, inner: boolean): number {
  return k > 0 && inner && key[k] === ' ' ? k + 1 : k
}

/** C2-I-001: the content escapes an ASCII punctuation character at `at` that the key holds bare at `k`. */
function dropsEscape(content: string, at: number, key: string, k: number): boolean {
  const next = content[at + 1]
  return content[at] === '\\' && next !== undefined && next !== '\\' && key[k] === next && isAsciiPunctuation(next.charCodeAt(0))
}

/** C2-I-001: the key holds an escape of the ASCII punctuation character `char` at `k`. */
function keyEscapes(key: string, k: number, char: string): boolean {
  return key[k] === '\\' && key[k + 1] === char && char !== '\\' && isAsciiPunctuation(char.charCodeAt(0))
}

function spaceRunEnd(content: string, at: number): number {
  let end = at
  while (end < content.length && isLabelSpace(content[end]!)) end++
  return end
}

function isLabelSpace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n'
}

function imageNode(w: Writer, node: ImageNode, flags: number): string {
  const raw = rawReference(w, node, flags)
  if (raw !== null) return `!${raw}`
  const pipes = (flags & IN_CELL) !== 0
  if (node.key === undefined && /[\r\n]/u.test(node.tooltip ?? '')) lose(w, node, 'tooltip')
  const alt = collapsedAlt(node, altSource(node.alt ?? '', w.bareAlts))
  return `![${pipes ? escapePipes(alt) : alt}]${target(node, node.src, pipes)}`
}

/** C2-W-075: the alt text of a collapsed or shortcut reference folds to its key (C2-I-079), or a spelling of it does. */
function collapsedAlt(node: ImageNode, alt: string): string {
  const key = node.key
  if ((node.refForm !== 'collapsed' && node.refForm !== 'shortcut') || key === undefined || foldLabel(alt) === key) return alt
  return labelLike(alt, key, (candidate) => {
    const read = inlineContent(`![${candidate}][]`)
    const image = read.length === 1 ? read[0] : undefined
    return image?.type === 'image' && image.key === key && image.alt === node.alt
  })
}

/**
 * The brackets of `alt` outside raw content that have no partner in it. Unescaped, a `[^` and its partner read as a
 * footnote label and end the image text early, so a `]` right behind `[^` counts as one, and a lone `]` after such a
 * pair takes over its `[`.
 */
function unpartnered(alt: string, raw: Uint8Array, lone: Set<number>): void {
  const open: number[] = []
  const notes: number[] = []
  for (let at = 0; at < alt.length; at++) {
    if (raw[at] === 1) continue
    if (alt[at] === '[') open.push(at)
    else if (alt[at] !== ']') continue
    else if (at >= 2 && alt[at - 1] === '^' && open.at(-1) === at - 2) lone.add(at)
    else if (open.length > 0) closeBracket(alt, open.pop()!, at, notes)
    else lone.add(notes.pop() ?? at)
  }
  for (const at of open) lone.add(at)
}

function closeBracket(alt: string, opener: number, at: number, notes: number[]): void {
  if (alt[opener + 1] === '^') notes.push(at)
}

/** The end of the code span or braced comment that opens at `at` of `alt`, -1 if it has no closer, 0 if none opens. */
function atomEnd(alt: string, at: number): number {
  if (alt[at] === '{' && (alt[at + 1] === '#' || alt[at + 1] === '%')) {
    const close = alt.indexOf(`${alt[at + 1]!}}`, at + 2)
    return close < 0 ? -1 : close + 2
  }
  if (alt[at] !== '`' || alt[at - 1] === '`') return 0
  let size = 1
  while (alt[at + size] === '`') size++
  for (let next = alt.indexOf('`', at + size); next >= 0; next = alt.indexOf('`', next + 1)) {
    let length = 1
    while (alt[next + length] === '`') length++
    if (length === size) return next + size
    next += length - 1
  }
  return -1
}

/**
 * Marks the content of code spans and braced comments in `alt` as raw. An opener with no closer in `alt` counts as
 * lone: its content is raw, so the reader would take a closer behind the image and end the image text early.
 */
function rawAtoms(alt: string, lone: Set<number>): Uint8Array {
  const raw = new Uint8Array(alt.length)
  for (let at = 0; at < alt.length; at++) {
    const end = atomEnd(alt, at)
    if (end > 0) raw.fill(1, at, end)
    if (end > 0) at = end - 1
    else if (end < 0) lone.add(at)
    while (end < 0 && alt[at] === '`' && alt[at + 1] === '`') lone.add(++at)
  }
  return raw
}

/**
 * C2-W-097: alt text doubles a backslash before ASCII punctuation or at its end, and escapes a bracket with no partner.
 * An opener of raw content with no closer takes one for the same reason (G-G8 in _SPEC_GAPS.md).
 */
function altSource(alt: string, bare = false): string {
  const lone = new Set<number>()
  const raw = rawAtoms(alt, lone)
  if (!bare) unpartnered(alt, raw, lone)
  let out = ''
  for (let at = 0; at < alt.length; at++) {
    const char = alt[at]!
    if (char === '\\' && (at + 1 === alt.length || isAsciiPunctuation(alt.charCodeAt(at + 1)))) out += '\\'
    else if (lone.has(at)) out += '\\'
    out += char
  }
  return out
}

/** C2-W-116: an autolink is its target in angle brackets; the text of an email address is the address. */
function autolinkNode(w: Writer, node: AutolinkNode): string {
  const href = node.href
  const text = node.text
  if (text === undefined) return `<${href}>`
  if (href !== `mailto:${text}`) lose(w, node, 'text')
  return href.startsWith('mailto:') ? `<${href.slice(7)}>` : `<${href}>`
}

function mentionNode(w: Writer, node: MentionNode): string {
  if (node.label !== undefined) lose(w, node, 'label')
  else if (node.kind !== 'user') lose(w, node, 'kind')
  return `@${node.target}`
}

/** C2-W-022, C2-W-117: a line comment; a value that ends with a space or a tab loses it, and the loss is reported. */
export function lineCommentText(w: Writer, node: CommentNode, value: string): string {
  const kept = trimEnd(value)
  if (kept.length !== value.length) lose(w, node, 'value')
  return kept === '' ? '%%' : `%% ${kept}`
}

/** C2-W-059: the comment forms that inline content holds. */
function commentNode(w: Writer, node: CommentNode, flags: number): string {
  const value = cellValue(w, node, node.value, flags)
  // C2-W-005, C2-A-074: where a padded line reads as a block opener, the value stands glued to the marks,
  // which read the same value where it does not start or end with a space.
  const glued = (w.forms.get(node) ?? 0) > 0 && !value.startsWith(' ') && !value.endsWith(' ')
  if (node.form === 'braced') return glued ? `{%${value}%}` : bracedComment(value)
  return lineCommentText(w, node, value)
}

function abbreviationNode(w: Writer, node: NodeOfType['abbreviation']): string {
  const key = node.key
  // C2-W-117: without a definition of its key the word reads back as text.
  if (!w.abbreviations.has(key)) lose(w, node, null)
  return key
}

/** C2-A-175: ruby is each base with its annotation in parentheses. */
function rubyNode(w: Writer, node: RubyNode, flags: number): string {
  lose(w, node, null)
  let out = ''
  for (const pair of node.pairs) out += `${writeInlines(w, pair.base, flags)}(${writeInlines(w, pair.annotation, flags)})`
  return out
}

/** C2-A-175: a node with no spelling of its own is its children, or its fallback. */
function childrenOnly(w: Writer, node: Node, flags: number): string {
  lose(w, node, null)
  const fallback = 'fallback' in node ? node.fallback : undefined
  return writeInlines(w, fallback ?? childNodes(node), flags)
}

function hardBreak(_w: Writer, _node: Node, flags: number): string {
  return (flags & BARE_BREAKS) !== 0 ? '\n' : '\\\n'
}

function citationGroup(w: Writer, node: CitationGroupNode): string {
  lose(w, node, null)
  return node.raw
}

function inlineExtension(w: Writer, node: InlineExtensionNode, flags: number): string {
  if (!node.name.includes('.')) return `:${node.name}[${writeInlines(w, node.children, flags)}]`
  const source = node.source
  if (source?.form === 'inline') {
    const form = `:${source.name}[${source.body}]`
    let same = w.extensions.length === 0
    if (!same) {
      try {
        const parsed = parseChunk(w, `${form}${braceBlock(node)}\n`).children[0]
        same = parsed?.type === 'paragraph' && parsed.children.length === 1 && treesEqual(node, parsed.children[0]!)
      } catch { same = false }
    }
    if (same) return form
  }
  lose(w, node, null)
  return writeInlines(w, node.fallback ?? node.children, flags)
}

const WRITERS: InlineWriters = {
  text: textNode,
  soft_break: () => '\n',
  hard_break: hardBreak,
  emphasis: paired('/', 1, IN_EMPHASIS),
  strong: paired('*', 2, IN_STRONG),
  underline: braced('_', '_'),
  strike: braced('~', '~'),
  highlight: braced('=', '='),
  superscript: braced('^', '^'),
  subscript: braced(',', ','),
  insert: braced('+', '+'),
  delete: braced('-', '-'),
  critic_comment: (w, node, flags) => `{#${cellValue(w, node, node.value, flags)}#}`,
  span: (w, node, flags) => `[${writeInlines(w, node.children, flags)}]`,
  link: linkNode,
  image: imageNode,
  inline_footnote: (w, node, flags) => `^[${writeInlines(w, node.children, flags | IN_NOTE)}]`,
  inline_extension: inlineExtension,
  footnote_ref: (_w, node) => `[^${labelText(node.key)}]`,
  code: (w, node, flags) => spanValue(w, node, node.value, flags),
  literal_inline: (w, node, flags) => `!${spanValue(w, node, node.value, flags)}`,
  math: (w, node, flags) => `${node.display ? '$$' : '$'}${spanValue(w, node, node.value, flags)}`,
  raw_inline: (w, node, flags) => `${spanValue(w, node, node.value, flags)}{=${node.format}}`,
  symbol: (_w, node) => `:${node.name}:`,
  mention: mentionNode,
  tag: (_w, node) => `#${node.name}`,
  autolink: autolinkNode,
  xref: (_w, node) => `</#${node.key}>`,
  non_breaking_space: () => '\\ ',
  smart_punctuation: (_w, node) => node.source,
  abbreviation: abbreviationNode,
  // The mark of a caption number is the first bare `#` of the caption (C2-B-207).
  caption_number: () => '#',
  comment: commentNode,
  small_caps: childrenOnly,
  citation_group: citationGroup,
  ruby: rubyNode,
}

/** The source of `node` by the writer of its type, or null where its type has none. */
function writeOwn<T extends keyof NodeOfType>(w: Writer, type: T, node: NodeOfType[T], flags: number): string | null {
  const writer = WRITERS[type]
  return writer === undefined ? null : writer(w, node, flags)
}

export function writeInline(w: Writer, node: Node, flags: number): string {
  const out = writeOwn(w, node.type, node, flags)
  if (out === null) return childrenOnly(w, node, flags)
  // C2-W-076: the attribute block is glued to its host. C2-I-040: a span takes the block with no part.
  const block = braceBlock(node, (flags & IN_CELL) !== 0 ? { pipes: true } : undefined)
  return node.type === 'span' && block === '' ? `${out}{}` : out + block
}

/** The source of a list of inline nodes. */
/** The end of the part that starts at `nodes[at]`: a run of code spans, or the node alone. */
function partEnd(w: Writer, nodes: readonly Node[], at: number): number {
  return joinsNextCode(nodes, at) ? codeRunEnd(w, nodes, at) : at + 1
}

/** C2-W-112: the code span `nodes[at]` has the code span behind it glued to it, with no attribute block between. */
export function joinsNextCode(nodes: readonly Node[], at: number): boolean {
  const node = nodes[at]!
  return node.type === 'code' && braceBlock(node) === '' && nodes[at + 1]?.type === 'code'
}

/** The written form of the part `nodes[at..end)`. */
function writePart(w: Writer, nodes: readonly Node[], at: number, end: number, flags: number): string {
  const node = nodes[at]!
  if (node.type === 'non_breaking_space' && nodes[at + 1]?.type === 'soft_break') return unspelledSpace(w, node)
  const part = end > at + 1 ? codeRun(nodes, at, end) : writeInline(w, node, flags)
  // C2-W-022: no space or tab of text stands at the end of a line. Before the backslash of a hard break it is text.
  return node.type === 'text' && nodes[at + 1]?.type === 'soft_break' ? trimEnd(part) : part
}

/** C2-W-022: a no-break space before a soft break or at the end of the content is written as U+00A0, and reported. */
function unspelledSpace(w: Writer, node: Node): string {
  lose(w, node, null)
  return '\u00a0'
}

/**
 * The spelling of `nodes[at, end)` behind the character `before`. C2-W-069: a bare mark glued to the same mark
 * before it makes one run and opens nothing, so the node is braced.
 */
function gluedPart(w: Writer, nodes: readonly Node[], at: number, end: number, flags: number, before: number): string {
  const node = nodes[at]!
  const mark = node.type === 'emphasis' ? '/' : node.type === 'strong' ? '*' : null
  if (mark !== null && nodes[end]?.type === 'text' && nodes[end].value.startsWith(mark)) w.forms.set(node, 1)
  const part = writePart(w, nodes, at, end, flags)
  if ((node.type !== 'emphasis' && node.type !== 'strong') || part === '' || part.charCodeAt(0) !== before) return part
  w.forms.set(node, 1)
  // A braced part already opens with `{`; writing it again gives the same bytes and doubles the cost per level.
  return part.charCodeAt(0) === BRACE ? part : writePart(w, nodes, at, end, flags)
}

/** C2-I-102: in a hard-break block a line ending alone at the start of a line is a blank line, so the break keeps its backslash. */
export function lineStartBreak(node: Node, lineStart: boolean): string | null {
  return node.type === 'hard_break' && lineStart ? '\\\n' : null
}

function braceBeforeCommentCloser(w: Writer, node: TextNode, comment: Node | undefined, after: Node | undefined, flags: number): void {
  if (comment?.type !== 'comment' || comment.form !== 'line' || after !== undefined || (flags & (IN_NOTE | IN_BRACKET)) === 0) return
  const braces = unclosedBraces(node.value, 0)
  if (braces.length === 0) return
  const escapes = w.escapes.get(node) ?? []
  w.escapes.set(node, [...new Set([...escapes, ...braces])].sort((a, b) => a - b))
}

function unclosedBraces(value: string, start: number): number[] {
  const open: { mark: string, at: number }[] = []
  for (let at = start; at + 1 < value.length; at++) {
    if (value[at] === '\\' && isAsciiPunctuation(value.charCodeAt(at + 1))) { at++; continue }
    if (value[at] === '{' && '*/-='.includes(value[at + 1]!)) open.push({ mark: value[at + 1]!, at })
    else if (value[at + 1] === '}' && open.at(-1)?.mark === value[at]) open.pop()
  }
  return open.map((entry) => entry.at)
}

function spanClosingBracket(w: Writer, node: TextNode, before: Node | undefined): void {
  if (before?.type !== 'strong' && before?.type !== 'emphasis') return
  if (!node.value.includes(']') || !before.children.some((child) => child.type === 'text' && /^\^\[[^\]]*\[/.test(child.value))) return
  const closing = node.value.indexOf(']')
  const escapes = w.escapes.get(node) ?? []
  if (!escapes.includes(closing)) w.escapes.set(node, [...escapes, closing].sort((a, b) => a - b))
}

function braceBesidePair(w: Writer, node: TextNode, next: Node | undefined, atEnd: boolean, flags: number): void {
  const pairedNext = next?.type === 'strong' ? !bracedPair(w, next, flags, 2, IN_STRONG)
    : next?.type === 'emphasis' && !bracedPair(w, next, flags, 1, IN_EMPHASIS)
  const pairedEnd = atEnd && (flags & (IN_STRONG | IN_EMPHASIS)) !== 0
  if (!node.value.endsWith('{') || (!pairedNext && !pairedEnd)) return
  const at = node.value.length - 1
  const escapes = w.escapes.get(node) ?? []
  if (!escapes.includes(at)) w.escapes.set(node, [...escapes, at].sort((a, b) => a - b))
}

function placeEscapes(w: Writer, nodes: readonly Node[], at: number, end: number, flags: number, afterBang: boolean): void {
  const node = nodes[at]!
  if (node.type === 'text') {
    doubleLastBackslash(w, node, nodes, end, flags)
    escapeGluedBacktick(w, node, nodes[at - 1])
    braceBeforeCommentCloser(w, node, nodes[end], nodes[end + 1], flags)
    spanClosingBracket(w, node, nodes[at - 1])
    braceBesidePair(w, node, nodes[end], end === nodes.length, flags)
  }
  // Behind an unescaped `!` the bracket reads as span text whatever the caret starts.
  if (node.type === 'span' && !afterBang) escapeLeadingCaret(w, node.children, flags)
}

function inlinePart(w: Writer, nodes: readonly Node[], at: number, end: number, flags: number,
  last: number, lineStart: boolean): string {
  const first = lineStartBreak(nodes[at]!, lineStart)
  if (first !== null) return first
  if (nodes[at]?.type === 'hard_break' && (flags & BARE_BREAKS) !== 0 && (last === SPACE || last === TAB)) return '\\\n'
  return gluedPart(w, nodes, at, end, flags, last)
}

export function writeInlines(w: Writer, nodes: readonly Node[], flags: number): string {
  let out = ''
  // Whether `out` is empty or ends a line. Asking the string itself would flatten it once per node.
  let lineStart = true
  // The last character of `out`, kept apart for the same reason.
  let last = -1
  for (let at = 0; at < nodes.length;) {
    const node = nodes[at]!
    // C2-I-023: a line comment starts at the start of a line or after whitespace, which it takes with it.
    if (node.type === 'comment' && node.form !== 'braced' && !lineStart) {
      out += ' '
      last = SPACE
    }
    // C2-L-021: a fragment of a continuation row starts at this node; the joining space is the line break.
    if ((flags & IN_CELL) !== 0 && w.wrapStarts?.has(node) === true) {
      out = `${out.endsWith(' ') ? out.slice(0, -1) : out}\n`
      lineStart = true
      last = 10
    }
    const end = partEnd(w, nodes, at)
    placeEscapes(w, nodes, at, end, flags, last === EXCLAMATION && out.charCodeAt(out.length - 2) !== BACKSLASH)
    const part = inlinePart(w, nodes, at, end, flags, last, lineStart)
    out += part
    last = part === '' ? last : part.charCodeAt(part.length - 1)
    lineStart = last === 10 || (lineStart && part === '')
    at = end
  }
  return out
}

/**
 * C2-W-097: a backslash that ends a text is written as two where what follows it is ASCII
 * punctuation, a space or the end of a line: the end of a list of inlines is the closing mark of
 * its node or the end of the content. The second backslash is kept as an escape of the text, so
 * the test of a parse counts it where it counts the others.
 */
function doubleLastBackslash(w: Writer, node: TextNode, nodes: readonly Node[], next: number, flags: number): void {
  const value = node.value
  const last = value.length - 1
  if (last < 0 || value.charCodeAt(last) !== BACKSLASH) return
  const escapes = w.escapes.get(node)
  if (escapes?.[escapes.length - 1] === last) return
  const after = nodes[next]
  if (after !== undefined && after.type !== 'soft_break' && after.type !== 'hard_break') {
    const spelled = writePart(w, nodes, next, partEnd(w, nodes, next), flags)
    const code = spelled.charCodeAt(0)
    if (spelled !== '' && code !== SPACE && !isAsciiPunctuation(code)) return
  }
  w.escapes.set(node, [...(escapes ?? []), last])
}

/**
 * C2-I-015, C2-W-125 case six: a backtick of text glued behind a code, literal-text or math span makes its closing run
 * longer, so the span would not form; the procedure takes that backslash in every case, and it is placed first.
 */
function escapeGluedBacktick(w: Writer, node: TextNode, before: Node | undefined): void {
  if (node.value.charCodeAt(0) !== BACKTICK || before === undefined || before.attrs !== undefined) return
  if (before.type !== 'code' && before.type !== 'literal_inline' && before.type !== 'math') return
  const escapes = w.escapes.get(node) ?? []
  if (escapes[0] !== 0) w.escapes.set(node, [0, ...escapes])
}

/** The source of the content of a text leaf: no space or tab of text stands at its end (C2-W-022). */
export function writeContent(w: Writer, nodes: readonly Node[], flags: number): string {
  const last = nodes[nodes.length - 1]
  if (last?.type === 'non_breaking_space') return writeInlines(w, nodes.slice(0, -1), flags) + unspelledSpace(w, last)
  const out = writeInlines(w, nodes, flags)
  if (last?.type === 'text') return trimEnd(out)
  // The line ending of a hard break at the end of the content is the line ending of the leaf (C2-W-022). In a hard-break
  // block that line ending alone is no break at the end of the content, so the backslash stays (C2-I-102).
  if (last?.type !== 'hard_break' || !out.endsWith('\n')) return out
  // A break that starts a line was written with its backslash (lineStartBreak).
  const before = out.charCodeAt(out.length - 3)
  const spelled = out.endsWith('\\\n') && (out.length === 2 || before === 10 || before === SPACE || before === TAB)
  return (flags & BARE_BREAKS) !== 0 && !spelled ? `${out.slice(0, -1)}\\` : out.slice(0, -1)
}

/** C2-W-112: the end of the run of code spans that starts at `from`. Each span behind the first is reported. */
function codeRunEnd(w: Writer, nodes: readonly Node[], from: number): number {
  let end = from + 1
  while (joinsNextCode(nodes, end - 1)) lose(w, nodes[end++]!, null)
  return end
}

/** C2-W-112: code spans with nothing between them have no spelling, so their content is written as one span. */
function codeRun(nodes: readonly Node[], from: number, end: number): string {
  let value = ''
  for (let at = from; at < end; at++) {
    const node = nodes[at]
    if (node?.type === 'code') value += node.value
  }
  // Only the last span of the run can have an attribute block, which then stands behind the run.
  return codeSpan(value) + braceBlock(nodes[end - 1]!)
}
