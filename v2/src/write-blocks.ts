// The block nodes as Carve source: the layout of C2-W-017 to C2-W-034 and the canonical forms of
// C2-W-035 to C2-W-060. A block writes its lines behind `prefix`, the prefix of its containers.
import { type AstNode, childrenOf, classesOf, hrefOf, keyOf, levelOf, valueOf } from './ast.ts'
import { DIV_KINDS, HARD_BREAKS_CLASS } from './tree-tables.ts'
import { type BlockParts, braceBlock, isName, quoted } from './write-attributes.ts'
import { BARE_BREAKS, bracedComment, writeContent, writeInlines } from './write-inline.ts'
import { listMarkers, sameListKind } from './write-lists.ts'
import { emit, emitLines, lose, notePlace, type Writer } from './write-state.ts'
import { writeTable } from './write-table.ts'

type BlockWriter = (w: Writer, node: AstNode, prefix: string, flags: number) => void

const MIN_RUN = 3
const MAX_HEADING_LEVEL = 6
/** C2-W-028: the blank lines that keep two lists of one kind apart. */
const LIST_BOUNDARY_BLANKS = 3
const SPACE = 32
const TAB = 9

/** C2-W-047: the attributes of a block, as one brace block on the line above it. */
export function attributeLine(w: Writer, node: AstNode, prefix: string, extra?: BlockParts): void {
  const block = braceBlock(node, extra)
  if (block !== '') emit(w, prefix, block)
}

function isFenced(w: Writer, node: AstNode): boolean {
  return w.facts?.get(node)?.fenced === true
}

/** C2-W-039: whether `node` is written with a colon run. */
function hasColonRun(w: Writer, node: AstNode): boolean {
  const type = node.type
  if (type === 'block_quote') return isFenced(w, node)
  return type === 'div' || type === 'admonition' || type === 'directive' || type === 'figure_group' || type === 'line_block'
}

/** The longest colon run among the blocks below `node`, or 0. */
function runsBelow(w: Writer, node: AstNode): number {
  const known = w.colonRuns.get(node)
  if (known !== undefined) return known
  let longest = 0
  for (const child of childrenOf(node)) {
    longest = Math.max(longest, hasColonRun(w, child) ? runsBelow(w, child) + 1 : runsBelow(w, child))
  }
  // A run has at least three colons, so the first level counts three.
  if (longest > 0 && longest < MIN_RUN) longest = MIN_RUN
  w.colonRuns.set(node, longest)
  return longest
}

/** C2-W-039: the shortest colon run of at least three that is longer than the run of every div inside. */
function colonRun(w: Writer, node: AstNode): string {
  return ':'.repeat(Math.max(MIN_RUN, runsBelow(w, node) + 1))
}

/** The longest run of `char` that stands alone on a line of `lines`, at any indent (C2-W-038). */
function longestBareRun(lines: readonly string[], char: number): number {
  let longest = 0
  for (const line of lines) {
    let start = 0
    while (start < line.length && (line.charCodeAt(start) === SPACE || line.charCodeAt(start) === TAB)) start++
    let end = start
    while (end < line.length && line.charCodeAt(end) === char) end++
    let rest = end
    while (rest < line.length && (line.charCodeAt(rest) === SPACE || line.charCodeAt(rest) === TAB)) rest++
    if (rest === line.length) longest = Math.max(longest, end - start)
  }
  return longest
}

/**
 * C2-W-005: a fence at the end of a list, a quote or another body that a comment line follows
 * as a sibling is written without its closer. The comment line then ends the body with the fence
 * (C2-B-111, C2-B-135); behind a closed fence it would be a child of the body (C2-B-138).
 */
function isLeftOpen(w: Writer, node: AstNode): boolean {
  return (w.forms.get(node) ?? 0) > 0
}

/** The lines of a verbatim value. C2-W-033: a value with no final line break is written with one. */
function valueLines(w: Writer, node: AstNode): string[] {
  const value = valueOf(node)
  if (value === '') return []
  const lines = value.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  else lose(w, node, 'value')
  return lines
}

/**
 * C2-W-040: the quoted title and the label of an opener. `title` is the title as its text, and
 * `spelled` as it stands between the quotes. A field the opener cannot hold is left out.
 */
function openerTail(w: Writer, node: AstNode, title: string | null, spelled: string): string {
  let out = ''
  if (title !== null && (title.includes('"') || title.includes('\n'))) lose(w, node, 'title')
  else if (title !== null) out += ` "${spelled}"`
  const label = node.groupLabel
  if (label === undefined) return out
  if (label.includes(']') || label.includes('\n')) lose(w, node, 'groupLabel')
  else out += ` [${label}]`
  return out
}

function codeTitle(node: AstNode): string | null {
  if (!Array.isArray(node.title)) return typeof node.title === 'string' ? node.title : null
  let text = ''
  for (const part of node.title) text += valueOf(part)
  return text
}

/** C2-W-037, C2-W-038, C2-W-040: a code block, and a raw block as the fence with `=` and its format. */
function codeBlock(w: Writer, node: AstNode, prefix: string): void {
  attributeLine(w, node, prefix)
  const lines = valueLines(w, node)
  const run = '`'.repeat(Math.max(MIN_RUN, longestBareRun(lines, 96) + 1))
  let info = node.type === 'raw_block' ? `=${node.format ?? ''}` : node.syntax ?? ''
  if (node.type === 'code_block') {
    const title = codeTitle(node)
    // C2-B-120: the title reads escapes, as a quoted attribute value does.
    info += openerTail(w, node, title, title === null ? '' : quoted(title).slice(1, -1))
  }
  emit(w, prefix, run + info)
  for (const line of lines) emit(w, prefix, line)
  if (!isLeftOpen(w, node)) emit(w, prefix, run)
}

/** C2-W-059: a line comment, and a comment block with the shortest percent run its body allows. */
function comment(w: Writer, node: AstNode, prefix: string): void {
  const value = valueOf(node)
  attributeLine(w, node, prefix)
  if (node.form !== 'block') {
    if (value.includes('\n')) lose(w, node, 'value')
    emit(w, prefix, node.form === 'braced' ? bracedComment(value) : value === '' ? '%%' : `%% ${value}`)
    return
  }
  const lines = value === '' ? [] : value.split('\n')
  const run = '%'.repeat(Math.max(MIN_RUN, longestBareRun(lines, 37) + 1))
  emit(w, prefix, run)
  for (const line of lines) emit(w, prefix, line)
  if (!isLeftOpen(w, node)) emit(w, prefix, run)
}

/** C2-W-052: the bare opener for YAML, and the format name glued to it for every other format. */
function frontmatter(w: Writer, node: AstNode, prefix: string): void {
  emit(w, prefix, node.format === undefined || node.format === 'yaml' ? '---' : `---${node.format}`)
  for (const line of valueLines(w, node)) emit(w, prefix, line)
  emit(w, prefix, '---')
}

function textLeaf(w: Writer, node: AstNode, prefix: string, flags: number, mark: string, indent: string): void {
  if (childrenOf(node).length === 0) return lose(w, node, null)
  attributeLine(w, node, prefix)
  if (node.type === 'paragraph') notePlace(w, node, prefix)
  w.lead = (w.lead ?? prefix) + mark
  emitLines(w, prefix, indent, writeContent(w, childrenOf(node), flags))
}

/** C2-W-035: `=`, one per level, and one space; a continuation line stands at the content column. */
function heading(w: Writer, node: AstNode, prefix: string, flags: number): void {
  let level = levelOf(node)
  if (level > MAX_HEADING_LEVEL) {
    lose(w, node, 'level')
    level = MAX_HEADING_LEVEL
  }
  textLeaf(w, node, prefix, flags, `${'='.repeat(level)} `, ' '.repeat(level + 1))
}

function isBarePath(path: string): boolean {
  if (path === '') return false
  for (const char of path) if (' \t#@{}"\'\\'.includes(char)) return false
  return true
}

const INCLUDE_OPTIONS: readonly string[] = ['lines', 'region', 'rows', 'cols', 'shift', 'code']

function optionRank(name: string): number {
  const rank = INCLUDE_OPTIONS.indexOf(name)
  return rank < 0 ? INCLUDE_OPTIONS.length : rank
}

function includeOption(pair: readonly [string, string]): string {
  const [key, value] = pair
  // C2-A-181: a part that is no option is kept as its text.
  if (key === '') return value
  if (value === '') return `@${key}`
  return `@${key}:${value.includes(' ') || value.includes('"') ? quoted(value) : value}`
}

/** C2-W-058: one space inside each brace pair and between the parts: the path, the section, the options. */
function include(w: Writer, node: AstNode, prefix: string): void {
  const path = node.path ?? ''
  attributeLine(w, node, prefix)
  if (path.includes('\n')) lose(w, node, 'path')
  let out = `{{ ${isBarePath(path) ? path : `"${path.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`}`
  if (node.section !== undefined) out += ` #${node.section}`
  // C2-W-058: the six options in the order of the directive grammar, then every other option in the order of the node.
  const options = [...(node.options ?? [])].sort((a, b) => optionRank(a[0]) - optionRank(b[0]))
  for (const pair of options) out += ` ${includeOption(pair)}`
  emit(w, prefix, `${out} }}`)
}

/** C2-W-056: a link definition; its attributes stand on the line above (C2-B-106). */
function linkDefinition(w: Writer, node: AstNode, prefix: string): void {
  attributeLine(w, node, prefix)
  const href = hrefOf(node)
  if (href === '') lose(w, node, 'href')
  const title = typeof node.title === 'string' ? ` ${quoted(node.title)}` : ''
  // C2-W-022: a definition with no destination ends at its colon.
  emit(w, prefix, `[${keyOf(node)}]:${href === '' && title === '' ? '' : ' '}${href}${title}`)
}

/** C2-W-024, C2-W-027: the blocks of a body behind its marker, the first on the marker line. */
function body(w: Writer, node: AstNode, prefix: string, flags: number, mark: string, width: number, tight: boolean): void {
  w.lead = (w.lead ?? prefix) + mark
  writeBlocks(w, childrenOf(node), prefix + ' '.repeat(width), flags, tight)
  if (w.lead === null) return
  // C2-W-057: an empty body has no spelling.
  lose(w, node, null)
  emit(w, prefix, '')
}

function footnote(w: Writer, node: AstNode, prefix: string, flags: number): void {
  attributeLine(w, node, prefix)
  body(w, node, prefix, flags, `[^${keyOf(node)}]: `, 2, false)
}

/** C2-B-040: a marker of one uppercase letter and a dot takes two spaces. */
function markerGap(marker: string): string {
  const code = marker.charCodeAt(0)
  return marker.length === 2 && marker[1] === '.' && code >= 65 && code <= 90 ? '  ' : ' '
}

function listItem(w: Writer, node: AstNode, prefix: string, flags: number, marker: string, tight: boolean): void {
  // C2-W-051: the attributes of an item are glued to its marker.
  const head = marker + braceBlock(node)
  const gap = markerGap(marker)
  // C2-W-046: the task box holds the character of `task.mark`.
  const box = node.task === undefined ? '' : `[${node.task.mark}] `
  body(w, node, prefix, flags, head + gap + box, marker.length + gap.length, tight)
}

/** The brace block above a list: its attributes, and the start value that no marker carries (C2-W-044). */
function listAttributes(node: AstNode, start: string | null): string {
  return braceBlock(node, start === null ? {} : { keys: [['start', start]] })
}

function list(w: Writer, node: AstNode, prefix: string, flags: number): void {
  const items = childrenOf(node)
  if (items.length === 0) return lose(w, node, null)
  const numbering = listMarkers(w, node)
  const block = listAttributes(node, numbering.start)
  if (block !== '') emit(w, prefix, block)
  const tight = node.spacing !== 'loose'
  for (let at = 0; at < items.length; at++) {
    // C2-W-030: a loose list has one blank line between all of its items.
    if (at > 0 && !tight) emit(w, prefix, '')
    listItem(w, items[at]!, prefix, flags, numbering.markers[at]!, tight)
  }
}

/** C2-W-060, C2-W-114: terms and descriptions with no blank line between them. */
function definitionList(w: Writer, node: AstNode, prefix: string, flags: number): void {
  const entries = childrenOf(node)
  if (entries.length === 0) return lose(w, node, null)
  attributeLine(w, node, prefix)
  writeSiblings(w, entries, prefix, flags, ENTRIES)
}

/** A block between an opener and a closer of one colon run. C2-W-032: an empty body is one blank line. */
function fenced(w: Writer, node: AstNode, prefix: string, opener: string, blankWhenEmpty: boolean, write: () => void): void {
  const run = colonRun(w, node)
  emit(w, prefix, run + opener)
  const mark = w.lines.length
  write()
  if (w.lines.length === mark && blankWhenEmpty) emit(w, prefix, '')
  emit(w, prefix, run)
}

/** C2-W-031, C2-W-082: a quote with `>` lines, or as a quote fence where the sidecar records that form. */
function blockQuote(w: Writer, node: AstNode, prefix: string, flags: number): void {
  attributeLine(w, node, prefix)
  const children = childrenOf(node)
  if (isFenced(w, node)) return fenced(w, node, prefix, ' >', false, () => writeBlocks(w, children, prefix, flags, false))
  if (children.length === 0) return emit(w, prefix, '>')
  w.lead = `${w.lead ?? prefix}> `
  writeBlocks(w, children, `${prefix}> `, flags, false)
  if (w.lead !== null) emit(w, prefix, '')
}

function titleTail(w: Writer, node: AstNode, flags: number): string {
  const title = Array.isArray(node.title) ? writeInlines(w, node.title, flags) : null
  return openerTail(w, node, title, title ?? '')
}

/** C2-W-039: the name of a plain div is its first class, where that class can be a name with no other meaning. */
function divName(node: AstNode): string | null {
  const first = node.attrs?.classes?.[0]
  return first !== undefined && isName(first) && !DIV_KINDS.has(first) ? first : null
}

/** C2-W-081: the opener of a hard-break block stands for the class, which it adds last (C2-A-068). */
function usesHardBreakOpener(w: Writer, node: AstNode): boolean {
  const classes = classesOf(node)
  if (classes[classes.length - 1] !== HARD_BREAKS_CLASS || node.title !== undefined || node.groupLabel !== undefined) return false
  return w.facts?.get(node)?.hardBreakOpener ?? true
}

function div(w: Writer, node: AstNode, prefix: string, flags: number): void {
  const classes = classesOf(node)
  if (usesHardBreakOpener(w, node)) {
    attributeLine(w, node, prefix, { skipClasses: [classes.length - 1] })
    // C2-W-080: behind the opener a hard break is the bare line ending. In the class form it keeps its backslash (C2-W-079).
    return fenced(w, node, prefix, ' \\', true, () => writeBlocks(w, childrenOf(node), prefix, flags | BARE_BREAKS, false))
  }
  const write = (): void => writeBlocks(w, childrenOf(node), prefix, flags, false)
  const name = divName(node)
  attributeLine(w, node, prefix, name === null ? {} : { skipClasses: [0] })
  fenced(w, node, prefix, (name === null ? '' : ` ${name}`) + titleTail(w, node, flags), true, write)
}

/** C2-W-039: an admonition and a directive are named by their kind. */
function namedDiv(w: Writer, node: AstNode, prefix: string, flags: number): void {
  attributeLine(w, node, prefix)
  if (node.tocTarget !== undefined) lose(w, node, 'tocTarget')
  const opener = ` ${node.kind ?? ''}${titleTail(w, node, flags)}`
  fenced(w, node, prefix, opener, true, () => writeBlocks(w, childrenOf(node), prefix, flags, false))
}

/** C2-W-053: `^`, one space and the content, directly below the block. */
function caption(w: Writer, node: AstNode | undefined, prefix: string, flags: number): void {
  if (node === undefined) return
  if (node.short !== undefined) lose(w, node, 'short')
  const blocks = childrenOf(node)
  // C2-W-012: the content of two former blocks is kept apart by a space.
  if (blocks.length !== 1) lose(w, node, null)
  const parts: string[] = []
  for (const block of blocks) parts.push(writeContent(w, childrenOf(block), flags))
  w.lead = `${w.lead ?? prefix}^ `
  emitLines(w, prefix, '  ', parts.join(' '))
}

/** The number of comments at the end of `nodes`. */
function trailingComments(nodes: readonly AstNode[]): number {
  let count = 0
  while (count < nodes.length && nodes[nodes.length - 1 - count]!.type === 'comment') count++
  return count
}

/** C2-W-059: the comments between a figure group and its caption stand between the closer and the caption line. */
function figureGroup(w: Writer, node: AstNode, prefix: string, flags: number): void {
  attributeLine(w, node, prefix)
  const children = childrenOf(node)
  const after = node.caption === undefined ? 0 : trailingComments(children)
  const inside = children.slice(0, children.length - after)
  fenced(w, node, prefix, ' figure', true, () => writeBlocks(w, inside, prefix, flags, false))
  for (const late of children.slice(children.length - after)) comment(w, late, prefix)
  caption(w, node.caption, prefix, flags)
}

/** C2-A-082: a captioned block, the comments below it and its caption, with no blank line between. */
function figure(w: Writer, node: AstNode, prefix: string, flags: number): void {
  attributeLine(w, node, prefix)
  if (node.kind !== undefined) lose(w, node, 'kind')
  for (const child of childrenOf(node)) writeBlock(w, child, prefix, flags)
  caption(w, node.caption, prefix, flags)
}

/** C2-W-032, C2-W-080: one line of source per `line`; an empty line block has its closer below its opener. */
function lineBlock(w: Writer, node: AstNode, prefix: string, flags: number): void {
  attributeLine(w, node, prefix)
  fenced(w, node, prefix, ' |', false, () => {
    for (const line of childrenOf(node)) emit(w, prefix, writeContent(w, childrenOf(line), flags | BARE_BREAKS))
  })
}

/** C2-A-175: a node with no spelling of its own is its children, or its fallback. */
function childrenOnly(w: Writer, node: AstNode, prefix: string, flags: number): void {
  lose(w, node, null)
  writeBlocks(w, node.fallback ?? childrenOf(node), prefix, flags, false)
}

function table(w: Writer, node: AstNode, prefix: string, flags: number): void {
  writeTable(w, node, prefix, flags)
  caption(w, node.caption, prefix, flags)
}

const WRITERS = new Map<string, BlockWriter>([
  ['paragraph', (w, node, prefix, flags) => textLeaf(w, node, prefix, flags, '', '')],
  ['heading', heading],
  ['thematic_break', (w, node, prefix) => {
    attributeLine(w, node, prefix)
    emit(w, prefix, '***')
  }],
  ['code_block', codeBlock],
  ['raw_block', codeBlock],
  ['comment', comment],
  ['frontmatter', frontmatter],
  ['include', include],
  ['link_reference_definition', linkDefinition],
  ['abbreviation_def', (w, node, prefix) => {
    attributeLine(w, node, prefix)
    emit(w, prefix, `*[${keyOf(node)}]: ${node.expansion ?? ''}`)
  }],
  ['footnote', footnote],
  ['list', list],
  ['definition_term', (w, node, prefix, flags) => textLeaf(w, node, prefix, flags, ':: ', '   ')],
  ['definition_description', (w, node, prefix, flags) => body(w, node, prefix, flags, ': ', 2, false)],
  ['definition_list', definitionList],
  ['block_quote', blockQuote],
  ['div', div],
  ['admonition', namedDiv],
  ['directive', namedDiv],
  ['figure_group', figureGroup],
  ['figure', figure],
  ['line_block', lineBlock],
  ['table', table],
])

function writeBlock(w: Writer, node: AstNode, prefix: string, flags: number): void {
  const writer = WRITERS.get(node.type) ?? childrenOnly
  writer(w, node, prefix, flags)
}

const LAZY_CONTAINERS: readonly string[] = [
  'list', 'list_item', 'block_quote', 'definition_list', 'definition_description', 'footnote', 'figure',
]
/** The containers that an indent or a mark keeps open, so that a comment-only line below one stays in it (C2-B-138). */
const OPEN_CONTAINERS: readonly string[] = ['list', 'list_item', 'definition_list', 'definition_description', 'footnote']
const OPAQUE: readonly string[] = ['code_block', 'raw_block']

/**
 * Whether a comment-only line directly below `node` would be read into it: as a lazy line of the
 * text leaf it ends in (C2-B-024), or as a child of a table (C2-A-086).
 */
function takesLineBelow(w: Writer, node: AstNode): boolean {
  const type = node.type
  if (type === 'paragraph' || type === 'definition_term' || type === 'table' || node.caption !== undefined) return true
  if (!LAZY_CONTAINERS.includes(type) || isFenced(w, node)) return false
  // A line without the quote mark directly below a quote stays in it (C2-B-138); a blank line ends the quote.
  if (type === 'block_quote') return true
  const last = node.children?.[node.children.length - 1]
  return last !== undefined && takesLineBelow(w, last)
}

function isOpenContainer(w: Writer, node: AstNode): boolean {
  return OPEN_CONTAINERS.includes(node.type) && !isFenced(w, node)
}

/** The fence that ends the open container `node`, or null. */
function lastFence(w: Writer, node: AstNode): AstNode | null {
  let at = node
  while (isOpenContainer(w, at)) {
    const last = at.children?.[at.children.length - 1]
    if (last === undefined) return null
    at = last
  }
  return OPAQUE.includes(at.type) || (at.type === 'comment' && at.form === 'block') ? at : null
}

function isCommentLine(node: AstNode | undefined): boolean {
  return node !== undefined && node.type === 'comment' && node.form !== 'block'
}

/** C2-W-059: the blank lines before the comment `node`, which follows `before`. */
function blankLinesBeforeComment(w: Writer, before: AstNode, node: AstNode): number {
  if (isCommentLine(node) && isOpenContainer(w, before)) {
    // C2-B-138: the line stays in the container, unless it ends a fence that the container ends with.
    if (lastFence(w, before) !== null) return 0
    lose(w, node, null)
    return 1
  }
  return takesLineBelow(w, before) || (w.forms.get(node) ?? 0) > 0 ? 1 : 0
}

/** The layout of a list of siblings: the blocks of a container, of a tight item, or the entries of a description list. */
const BLOCKS = 0
const TIGHT_ITEM = 1
const ENTRIES = 2

/** C2-W-017, C2-W-018, C2-W-028, C2-W-059: the blank lines between `before` and the block `node` below it. */
export function blankLinesBetween(w: Writer, before: AstNode, list: AstNode | null, node: AstNode, nested: boolean): number {
  if (node.type === 'comment') return blankLinesBeforeComment(w, before, node)
  if (list !== null && sameListKind(list, node)) return LIST_BOUNDARY_BLANKS
  return nested ? 0 : 1
}

/** C2-W-018: whether `node`, the second block of a tight item, is a nested list directly below the first paragraph. */
function isNestedList(w: Writer, before: AstNode, node: AstNode, at: number): boolean {
  if (at !== 1 || node.type !== 'list' || before.type !== 'paragraph') return false
  // An attribute line directly below the paragraph would be a lazy line of it (C2-B-024).
  return listAttributes(node, listMarkers(w, node).start) === ''
}

/** C2-B-138: the fence an open container ends with takes its other spelling where a comment line follows the container. */
function markFenceBeforeComment(w: Writer, node: AstNode, next: AstNode | undefined): void {
  if (!isCommentLine(next) || !isOpenContainer(w, node)) return
  const fence = lastFence(w, node)
  if (fence !== null) w.forms.set(fence, 1)
}

function writeSiblings(w: Writer, nodes: readonly AstNode[], prefix: string, flags: number, layout: number): void {
  let before: AstNode | null = null
  // The last block that is no comment: comments do not keep two lists apart (C2-B-053).
  let list: AstNode | null = null
  for (let at = 0; at < nodes.length; at++) {
    const node = nodes[at]!
    const start = w.lines.length
    if (before !== null) {
      // C2-W-114: no blank line stands between the entries of a description list.
      const nested = layout === ENTRIES || (layout === TIGHT_ITEM && isNestedList(w, before, node, at))
      for (let blank = blankLinesBetween(w, before, list, node, nested); blank > 0; blank--) emit(w, prefix, '')
    }
    markFenceBeforeComment(w, node, nodes[at + 1])
    const written = w.lines.length
    writeBlock(w, node, prefix, flags)
    if (w.lines.length === written) {
      // C2-W-029: a block that writes nothing leaves no blank line behind.
      w.lines.length = start
      continue
    }
    before = node
    if (node.type !== 'comment') list = node
  }
}

/**
 * Writes sibling blocks with the blank lines between them. In a tight list the nested list that
 * follows the first paragraph of its item takes no blank line (C2-W-018).
 */
export function writeBlocks(w: Writer, nodes: readonly AstNode[], prefix: string, flags: number, tight: boolean): void {
  writeSiblings(w, nodes, prefix, flags, tight ? TIGHT_ITEM : BLOCKS)
}
