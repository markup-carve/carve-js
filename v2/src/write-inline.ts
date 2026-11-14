// The inline nodes as Carve source (C2-W-069 to C2-W-080, C2-W-116). A line break of the
// content is a line feed in the string; the block that holds the content places the lines.
import {
  type AutolinkNode, childNodes, type CitationGroupNode, type CommentNode, type ImageNode, type InlineParent, type LinkNode,
  type MentionNode, type Node, type NodeOfType, type RubyNode, type TextNode,
} from './ast.ts'
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

const BACKSLASH = 92
const PIPE = 124
const SPACE = 32
const BACKTICK = 96

/** A writer per inline node type, each of which reads a node of its own type. */
type InlineWriters = { [T in keyof NodeOfType]?: (w: Writer, node: NodeOfType[T], flags: number) => string }

type InlineWriter = (w: Writer, node: InlineParent, flags: number) => string

/** C2-W-097: a backslash that the next character of the same text would make an escape is written twice. */
function doubles(value: string, at: number): boolean {
  if (at + 1 >= value.length) return false
  const next = value.charCodeAt(at + 1)
  return next === SPACE || isAsciiPunctuation(next)
}

/** The text `value[from, to)` with the backslashes it needs. */
function escaped(w: Writer, node: TextNode, value: string, from: number, to: number, cell: boolean): string {
  const escapes = w.escapes.get(node) ?? []
  let out = ''
  let next = firstFrom(escapes, from)
  let start = from
  for (let at = from; at < to; at++) {
    const code = value.charCodeAt(at)
    const asked = next < escapes.length && escapes[next] === at
    if (asked) next++
    if (!asked && !(code === BACKSLASH && doubles(value, at)) && !(cell && code === PIPE)) continue
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
export function spelledEnd(w: Writer, node: TextNode, from: number, bytes: number, cell: boolean): number {
  const value = node.value
  const escapes = w.escapes.get(node) ?? []
  let next = firstFrom(escapes, from)
  let rest = bytes
  let at = from
  for (; rest > 0 && at < value.length; at++) {
    const code = value.charCodeAt(at)
    const asked = next < escapes.length && escapes[next] === at
    if (asked) next++
    rest -= unitBytes(value, at) + (asked || (code === BACKSLASH && doubles(value, at)) || (cell && code === PIPE) ? 1 : 0)
  }
  return rest === 0 ? at : -1
}

function textNode(w: Writer, node: TextNode, flags: number): string {
  const value = node.value
  const cell = (flags & IN_CELL) !== 0
  const points = cell ? w.wrapPoints?.get(node) : undefined
  if (points === undefined && !w.escapes.has(node) && !value.includes('\\') && !(cell && value.includes('|'))) return value
  let out = ''
  let from = 0
  for (const point of points ?? []) {
    // C2-L-021: the joining space before the fragment is the line break of the continuation row.
    out += `${escaped(w, node, value, from, Math.max(from, point - 1), cell)}\n`
    from = point
  }
  return out + escaped(w, node, value, from, value.length, cell)
}

/** Whether emphasis (bit 1) and strong (bit 2) occur below `node` (C2-W-070). */
function kindsBelow(w: Writer, node: Node): number {
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
    const braced = (flags & inside) !== 0 || (kindsBelow(w, node) & bit) !== 0 || (w.forms.get(node) ?? 0) > 0
    return braced ? `{${mark}${content}${mark}}` : `${mark}${content}${mark}`
  }
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

/** C2-I-013: a destination reads only the escaped parenthesis and the escaped backslash. */
function destination(value: string): string {
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
    if (unmatched.has(at) || (char === '\\' && '()\\'.includes(next))) out += '\\'
    out += char
  }
  return out
}

/** C2-W-075: the label of a reference, from the tree. */
function referenceLabel(node: LinkNode | ImageNode, key: string): string {
  if (node.form === 'collapsed') return '[]'
  // C2-I-078: a label that starts with a caret or an at-sign is no reference label; the space folds away.
  return key.startsWith('^') || key.startsWith('@') ? `[ ${labelText(key)}]` : `[${labelText(key)}]`
}

/** C2-I-076, C2-I-079: a backslash at the end of a label would take its closing bracket; a space behind it folds away. */
function labelText(key: string): string {
  return key.endsWith('\\') ? `${key} ` : key
}

/** C2-W-073, C2-W-074: the link tail, or the label of a reference. */
function target(node: LinkNode | ImageNode, href: string | undefined): string {
  const key = node.key
  if (key !== undefined) return referenceLabel(node, key)
  const tooltip = node.tooltip
  const title = tooltip === undefined ? '' : ` ${quoted(tooltip)}`
  return `(${destination(href ?? '')}${title})`
}

/** C2-W-075, C2-W-084: the verbatim text of a reference, where the sidecar holds it and the reparse did not refuse it. */
function rawReference(w: Writer, node: LinkNode | ImageNode, flags: number): string | null {
  if (node.key === undefined || (w.forms.get(node) ?? 0) > 0) return null
  const raw = w.facts?.get(node)?.rawRef
  if (raw === undefined) return null
  if (!raw.includes('\n')) return raw
  // C2-W-067: a break inside a label of a cell is not kept; the label folds it to a space (C2-I-079).
  if ((flags & IN_CELL) !== 0) return raw.replaceAll(/[ \t]*\n[ \t]*/g, ' ')
  // C2-W-022: no space or tab stands at the end of a line of it.
  return raw.replaceAll(/[ \t]+\n/g, '\n')
}

function linkNode(w: Writer, node: LinkNode, flags: number): string {
  const raw = rawReference(w, node, flags)
  if (raw !== null) return raw
  return `[${writeInlines(w, node.children, flags)}]${target(node, node.href)}`
}

function imageNode(w: Writer, node: ImageNode, flags: number): string {
  return rawReference(w, node, flags) ?? `![${node.alt ?? ''}]${target(node, node.src)}`
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

/** C2-W-059: the comment forms that inline content holds. */
function commentNode(_w: Writer, node: CommentNode): string {
  const value = node.value
  if (node.form === 'braced') return bracedComment(value)
  return value === '' ? '%%' : `%% ${value}`
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
  critic_comment: (_w, node) => `{#${node.value}#}`,
  span: (w, node, flags) => `[${writeInlines(w, node.children, flags)}]`,
  link: linkNode,
  image: imageNode,
  inline_footnote: (w, node, flags) => `^[${writeInlines(w, node.children, flags)}]`,
  inline_extension: (w, node, flags) => `:${node.name}[${writeInlines(w, node.children, flags)}]`,
  footnote_ref: (_w, node) => `[^${labelText(node.key)}]`,
  code: (_w, node) => codeSpan(node.value),
  literal_inline: (_w, node) => `!${codeSpan(node.value)}`,
  math: (_w, node) => `${node.display ? '$$' : '$'}${codeSpan(node.value)}`,
  raw_inline: (_w, node) => `${codeSpan(node.value)}{=${node.format}}`,
  symbol: (_w, node) => `:${node.name}:`,
  mention: mentionNode,
  tag: (_w, node) => `#${node.name}`,
  autolink: autolinkNode,
  xref: (_w, node) => `</#${node.key}>`,
  non_breaking_space: () => '\\ ',
  smart_punctuation: (_w, node) => node.source,
  abbreviation: abbreviationNode,
  // The mark of a caption number is the first bare `#` of the caption (C2-B-150).
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

function writeInline(w: Writer, node: Node, flags: number): string {
  const out = writeOwn(w, node.type, node, flags)
  if (out === null) return childrenOnly(w, node, flags)
  // C2-W-076: the attribute block is glued to its host. C2-I-040: a span takes the block with no part.
  const block = braceBlock(node)
  return node.type === 'span' && block === '' ? `${out}{}` : out + block
}

/** The source of a list of inline nodes. */
/** The end of the part that starts at `nodes[at]`: a run of code spans, or the node alone. */
function partEnd(w: Writer, nodes: readonly Node[], at: number): number {
  return nodes[at]!.type === 'code' && nodes[at + 1]?.type === 'code' ? codeRunEnd(w, nodes, at) : at + 1
}

/** The written form of the part `nodes[at..end)`. */
function writePart(w: Writer, nodes: readonly Node[], at: number, end: number, flags: number): string {
  const node = nodes[at]!
  const part = end > at + 1 ? codeRun(nodes, at, end) : writeInline(w, node, flags)
  // C2-W-022: no space or tab of text stands at the end of a line. Before the backslash of a hard break it is text.
  return node.type === 'text' && nodes[at + 1]?.type === 'soft_break' ? trimEnd(part) : part
}

export function writeInlines(w: Writer, nodes: readonly Node[], flags: number): string {
  let out = ''
  // Whether `out` is empty or ends a line. Asking the string itself would flatten it once per node.
  let lineStart = true
  for (let at = 0; at < nodes.length;) {
    const node = nodes[at]!
    // C2-I-023: a line comment starts at the start of a line or after whitespace, which it takes with it.
    if (node.type === 'comment' && node.form !== 'braced' && !lineStart) out += ' '
    // C2-L-021: a fragment of a continuation row starts at this node; the joining space is the line break.
    if ((flags & IN_CELL) !== 0 && w.wrapStarts?.has(node) === true) {
      out = `${out.endsWith(' ') ? out.slice(0, -1) : out}\n`
      lineStart = true
    }
    const end = partEnd(w, nodes, at)
    const part = writePart(w, nodes, at, end, flags)
    out += part
    if (part !== '') lineStart = part.charCodeAt(part.length - 1) === 10
    at = end
  }
  return out
}

/** The source of the content of a text leaf: no space or tab of text stands at its end (C2-W-022). */
export function writeContent(w: Writer, nodes: readonly Node[], flags: number): string {
  const out = writeInlines(w, nodes, flags)
  const last = nodes[nodes.length - 1]
  if (last?.type === 'text') return trimEnd(out)
  // The line ending of a hard break at the end of the content is the line ending of the leaf (C2-W-022).
  return last?.type === 'hard_break' && out.endsWith('\n') ? out.slice(0, -1) : out
}

/** C2-W-112: the end of the run of code spans that starts at `from`. Each span behind the first is reported. */
function codeRunEnd(w: Writer, nodes: readonly Node[], from: number): number {
  let end = from + 1
  while (end < nodes.length && nodes[end]!.type === 'code') lose(w, nodes[end++]!, null)
  return end
}

/** C2-W-112: code spans with nothing between them have no spelling, so their content is written as one span. */
function codeRun(nodes: readonly Node[], from: number, end: number): string {
  let value = ''
  for (let at = from; at < end; at++) {
    const node = nodes[at]
    if (node?.type === 'code') value += node.value
  }
  return codeSpan(value) + braceBlock(nodes[from]!)
}
