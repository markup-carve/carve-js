// The inline nodes as Carve source (C2-W-069 to C2-W-080, C2-W-116). A line break of the
// content is a line feed in the string; the block that holds the content places the lines.
import { type AstNode } from './ast.ts'
import { braceBlock, isAsciiPunctuation, quoted } from './write-attributes.ts'
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

type InlineWriter = (w: Writer, node: AstNode, flags: number) => string

/** C2-W-097: a backslash that the next character of the same text would make an escape is written twice. */
function doubles(value: string, at: number): boolean {
  if (at + 1 >= value.length) return false
  const next = value.charCodeAt(at + 1)
  return next === SPACE || isAsciiPunctuation(next)
}

/** The text `value[from, to)` with the backslashes it needs. */
function escaped(w: Writer, node: AstNode, value: string, from: number, to: number, cell: boolean): string {
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

/** Bytes of the UTF-16 code unit `code` in UTF-8; the halves of a surrogate pair count two each. */
function unitBytes(code: number): number {
  if (code < 0x80) return 1
  if (code < 0x800) return 2
  return code >= 0xd800 && code <= 0xdfff ? 2 : 3
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
export function spelledEnd(w: Writer, node: AstNode, from: number, bytes: number, cell: boolean): number {
  const value = node.value ?? ''
  const escapes = w.escapes.get(node) ?? []
  let next = firstFrom(escapes, from)
  let rest = bytes
  let at = from
  for (; rest > 0 && at < value.length; at++) {
    const code = value.charCodeAt(at)
    const asked = next < escapes.length && escapes[next] === at
    if (asked) next++
    rest -= unitBytes(code) + (asked || (code === BACKSLASH && doubles(value, at)) || (cell && code === PIPE) ? 1 : 0)
  }
  return rest === 0 ? at : -1
}

function textNode(w: Writer, node: AstNode, flags: number): string {
  const value = node.value ?? ''
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
function kindsBelow(w: Writer, node: AstNode): number {
  const known = w.kindsBelow.get(node)
  if (known !== undefined) return known
  let kinds = 0
  for (const child of node.children ?? []) {
    if (child.type === 'emphasis') kinds |= 1
    else if (child.type === 'strong') kinds |= 2
    if (child.children !== undefined) kinds |= kindsBelow(w, child)
  }
  w.kindsBelow.set(node, kinds)
  return kinds
}

/** C2-W-116: a node that needs content and has none is left out. */
function contentOf(w: Writer, node: AstNode, flags: number): string | null {
  if ((node.children ?? []).length > 0) return writeInlines(w, node.children!, flags)
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
function referenceLabel(node: AstNode): string {
  if (node.form === 'collapsed') return '[]'
  const key = node.key ?? ''
  // C2-I-078: a label that starts with a caret or an at-sign is no reference label; the space folds away.
  return key.startsWith('^') || key.startsWith('@') ? `[ ${labelText(key)}]` : `[${labelText(key)}]`
}

/** C2-I-076, C2-I-079: a backslash at the end of a label would take its closing bracket; a space behind it folds away. */
function labelText(key: string): string {
  return key.endsWith('\\') ? `${key} ` : key
}

/** C2-W-073, C2-W-074: the link tail, or the label of a reference. */
function target(node: AstNode, field: 'href' | 'src'): string {
  if (node.key !== undefined) return referenceLabel(node)
  const title = node.tooltip === undefined ? '' : ` ${quoted(node.tooltip)}`
  return `(${destination(node[field] ?? '')}${title})`
}

/** C2-W-075, C2-W-084: the verbatim text of a reference, where the sidecar holds it and the reparse did not refuse it. */
function rawReference(w: Writer, node: AstNode): string | null {
  if (node.key === undefined || (w.forms.get(node) ?? 0) > 0) return null
  const raw = w.facts?.get(node)?.rawRef
  if (raw === undefined) return null
  // C2-W-022: no space or tab stands at the end of a line of it.
  return raw.includes('\n') ? raw.replaceAll(/[ \t]+\n/g, '\n') : raw
}

function linkNode(w: Writer, node: AstNode, flags: number): string {
  const raw = rawReference(w, node)
  if (raw !== null) return raw
  return `[${writeInlines(w, node.children ?? [], flags)}]${target(node, 'href')}`
}

function imageNode(w: Writer, node: AstNode): string {
  return rawReference(w, node) ?? `![${node.alt ?? ''}]${target(node, 'src')}`
}

/** C2-W-116: an autolink is its target in angle brackets; the text of an email address is the address. */
function autolinkNode(w: Writer, node: AstNode): string {
  const href = node.href ?? ''
  if (node.text === undefined) return `<${href}>`
  if (href !== `mailto:${node.text}`) lose(w, node, 'text')
  return href.startsWith('mailto:') ? `<${href.slice(7)}>` : `<${href}>`
}

function mentionNode(w: Writer, node: AstNode): string {
  if (node.label !== undefined) lose(w, node, 'label')
  else if (node.kind !== 'user') lose(w, node, 'kind')
  return `@${node.target ?? ''}`
}

/** C2-W-059: the comment forms that inline content holds. */
function commentNode(_w: Writer, node: AstNode): string {
  const value = node.value ?? ''
  if (node.form === 'braced') return `{% ${value} %}`
  return value === '' ? '%%' : `%% ${value}`
}

function abbreviationNode(w: Writer, node: AstNode): string {
  const key = node.key ?? ''
  // C2-W-117: without a definition of its key the word reads back as text.
  if (!w.abbreviations.has(key)) lose(w, node, null)
  return key
}

/** C2-A-175: ruby is each base with its annotation in parentheses. */
function rubyNode(w: Writer, node: AstNode, flags: number): string {
  lose(w, node, null)
  let out = ''
  for (const pair of node.pairs ?? []) out += `${writeInlines(w, pair.base, flags)}(${writeInlines(w, pair.annotation, flags)})`
  return out
}

/** C2-A-175: a node with no spelling of its own is its children, or its fallback. */
function childrenOnly(w: Writer, node: AstNode, flags: number): string {
  lose(w, node, null)
  return writeInlines(w, node.fallback ?? node.children ?? [], flags)
}

function hardBreak(_w: Writer, _node: AstNode, flags: number): string {
  return (flags & BARE_BREAKS) !== 0 ? '\n' : '\\\n'
}

const WRITERS = new Map<string, InlineWriter>([
  ['text', textNode],
  ['soft_break', () => '\n'],
  ['hard_break', hardBreak],
  ['emphasis', paired('/', 1, IN_EMPHASIS)],
  ['strong', paired('*', 2, IN_STRONG)],
  ['underline', braced('_', '_')],
  ['strike', braced('~', '~')],
  ['highlight', braced('=', '=')],
  ['superscript', braced('^', '^')],
  ['subscript', braced(',', ',')],
  ['insert', braced('+', '+')],
  ['delete', braced('-', '-')],
  ['critic_comment', (_w, node) => `{#${node.value ?? ''}#}`],
  ['span', (w, node, flags) => `[${writeInlines(w, node.children ?? [], flags)}]`],
  ['link', linkNode],
  ['image', imageNode],
  ['inline_footnote', (w, node, flags) => `^[${writeInlines(w, node.children ?? [], flags)}]`],
  ['inline_extension', (w, node, flags) => `:${node.name ?? ''}[${writeInlines(w, node.children ?? [], flags)}]`],
  ['footnote_ref', (_w, node) => `[^${labelText(node.key ?? '')}]`],
  ['code', (_w, node) => codeSpan(node.value ?? '')],
  ['literal_inline', (_w, node) => `!${codeSpan(node.value ?? '')}`],
  ['math', (_w, node) => `${node.display === true ? '$$' : '$'}${codeSpan(node.value ?? '')}`],
  ['raw_inline', (_w, node) => `${codeSpan(node.value ?? '')}{=${node.format ?? ''}}`],
  ['symbol', (_w, node) => `:${node.name ?? ''}:`],
  ['mention', mentionNode],
  ['tag', (_w, node) => `#${node.name ?? ''}`],
  ['autolink', autolinkNode],
  ['xref', (_w, node) => `</#${node.key ?? ''}>`],
  ['non_breaking_space', () => '\\ '],
  ['smart_punctuation', (_w, node) => node.source ?? ''],
  ['abbreviation', abbreviationNode],
  // The mark of a caption number is the first bare `#` of the caption (C2-B-150).
  ['caption_number', () => '#'],
  ['comment', commentNode],
  ['small_caps', childrenOnly],
  ['citation_group', (w, node) => {
    lose(w, node, null)
    return node.raw ?? ''
  }],
  ['ruby', rubyNode],
])

function writeInline(w: Writer, node: AstNode, flags: number): string {
  const writer = WRITERS.get(node.type)
  if (writer === undefined) return childrenOnly(w, node, flags)
  const out = writer(w, node, flags)
  // C2-W-076: the attribute block is glued to its host. C2-I-040: a span takes the block with no part.
  const block = braceBlock(node)
  return node.type === 'span' && block === '' ? `${out}{}` : out + block
}

/** The source of a list of inline nodes. */
export function writeInlines(w: Writer, nodes: readonly AstNode[], flags: number): string {
  let out = ''
  // Whether `out` is empty or ends a line. Asking the string itself would flatten it once per node.
  let lineStart = true
  for (let at = 0; at < nodes.length; at++) {
    const node = nodes[at]!
    // C2-I-023: a line comment starts at the start of a line or after whitespace, which it takes with it.
    if (node.type === 'comment' && node.form !== 'braced' && !lineStart) out += ' '
    const end = node.type === 'code' && nodes[at + 1]?.type === 'code' ? codeRunEnd(w, nodes, at) : at + 1
    let part = end > at + 1 ? codeRun(nodes, at, end) : writeInline(w, node, flags)
    // C2-W-022: no space or tab of text stands at the end of a line. Before the backslash of a hard break it is text.
    if (node.type === 'text' && nodes[at + 1]?.type === 'soft_break') part = trimEnd(part)
    out += part
    if (part !== '') lineStart = part.charCodeAt(part.length - 1) === 10
    at = end - 1
  }
  return out
}

/** The source of the content of a text leaf: no space or tab of text stands at its end (C2-W-022). */
export function writeContent(w: Writer, nodes: readonly AstNode[], flags: number): string {
  const out = writeInlines(w, nodes, flags)
  const last = nodes[nodes.length - 1]
  if (last?.type === 'text') return trimEnd(out)
  // The line ending of a hard break at the end of the content is the line ending of the leaf (C2-W-022).
  return last?.type === 'hard_break' && out.endsWith('\n') ? out.slice(0, -1) : out
}

/** C2-W-112: the end of the run of code spans that starts at `from`. Each span behind the first is reported. */
function codeRunEnd(w: Writer, nodes: readonly AstNode[], from: number): number {
  let end = from + 1
  while (end < nodes.length && nodes[end]!.type === 'code') lose(w, nodes[end++]!, null)
  return end
}

/** C2-W-112: code spans with nothing between them have no spelling, so their content is written as one span. */
function codeRun(nodes: readonly AstNode[], from: number, end: number): string {
  let value = ''
  for (let at = from; at < end; at++) value += nodes[at]!.value ?? ''
  return codeSpan(value) + braceBlock(nodes[from]!)
}
