import { INLINE_PARENTS, type Node } from '../src/ast.ts'
import { columnOf } from '../src/layout-lines.ts'
import { type Attributed } from './data-attributes.ts'
import { type NodeLayout } from '../src/layout.ts'
import { shapeOf } from './data-shape.ts'
import { groupOf, pipeTables, rowIndexOf, TableLines } from './data-table.ts'
import { type Line, type LintContext } from './types.ts'

/** The shared line model of `data/lint-model.json`: one record per source line and per block. */
export interface ModelLine {
  number: number
  start: number
  end: number
  text: string
  body: string
  body_start: number
  body_end: number
  blank: boolean
  leaf: string
  leaf_id: string
  leaf_first: boolean
  attached_here: boolean
  closes_container: boolean
  readonly ancestors: string[]
  readonly ancestor_ids: string[]
  readonly shape: string
  readonly quote_prefix: boolean
  readonly quote_depth: number
  readonly quote_marks: number
  readonly raw_body: string
  readonly lazy: boolean
  readonly open_colon: ColonContainer[]
  readonly prev: ModelLine | undefined
  readonly prev2: ModelLine | undefined
  readonly next: ModelLine | undefined
  readonly next2: ModelLine | undefined
  readonly leaf_next: ModelLine | undefined
  readonly leaf_head: ModelLine | undefined
  leaf_start: number
  readonly table_above: ModelLine | undefined
  readonly table_below: ModelLine | undefined
  readonly table_path: string | undefined
}

export interface ColonContainer { width: number, line: number, column: number, kind: string, start: number }

export interface ModelBlock {
  type: string
  path: string
  start: number
  readonly column: number
  readonly opener_column: number
  attributed: boolean
  image_line: boolean
  index: number
  readonly after_quote_mark: boolean
  readonly opener_start: number
  readonly mark_column: number
  readonly opener_text: string
  line: ModelLine
  readonly last_line: ModelLine
  readonly prev_type: string | undefined
  readonly end: number
  readonly text: string
  readonly owner: Container
  readonly item_owner: Container
  readonly parent: Container
  readonly node: Node
  readonly source_format: string | undefined
  readonly group: string | undefined
  readonly row_index: number | undefined
  readonly ancestors: string[]
  readonly ancestor_ids: string[]
  readonly identity: string
  readonly layout: NodeLayout | undefined
}

/** An inline record: one node of an inline content, with the leaf block that holds it. */
export interface ModelInline {
  type: string
  path: string
  start: number
  end: number
  readonly text: string
  leaf: string
  parent: string
  readonly node: Node | undefined
  readonly raw_ref?: string
}

export interface Container { readonly type: string, readonly content_column: number, readonly marker_column: number | undefined }

export interface LineModel<T> {
  /** Made on first read. */
  lines: { all(): ModelLine[] }
  blocks: ModelBlock[]
  /** The runs of each block, by the same index. */
  runs: (readonly T[])[]
}

const INLINE_HOLDERS: ReadonlySet<string> = new Set(['paragraph', 'caption', 'definition_term', 'heading', 'line',
  'cell_paragraph', 'code_block', 'raw_block', 'frontmatter', 'comment', 'include'])

const VERBATIM_LEAVES: ReadonlySet<string> = new Set(['code_block', 'comment_block', 'frontmatter', 'raw_block'])

const LEAF_TYPES: ReadonlySet<string> = new Set(['paragraph', 'caption', 'definition_term', 'heading', 'line', 'table_cell',
  'table_row', 'code_block', 'raw_block', 'frontmatter', 'comment_block'])

const isSpace = (code: number): boolean => code === 32 || code === 9

/** Behind leading spaces and tabs and every quote mark followed by a space or the line end (C2-B-031), at most `marks` of them. */
export function quotedStart(line: Line, marks = Infinity): number {
  const text = line.text
  let at = 0
  let left = marks
  while (isSpace(text.charCodeAt(at))) at++
  while (left-- > 0 && text.charCodeAt(at) === 62 && (text.charCodeAt(at + 1) === 32 || at + 1 === text.length)) {
    at = Math.min(at + 2, text.length)
    while (isSpace(text.charCodeAt(at))) at++
  }
  return line.start + at
}

function trimEndAt(text: string, from: number): number {
  let end = text.length
  while (end > from && isSpace(text.charCodeAt(end - 1))) end--
  return end
}

// Per tree, the depth of each path asked for, or undefined for a tree that holds no quote.
const depths = new WeakMap<Map<string, string>, Map<string, number> | undefined>()

function depthsOf(types: Map<string, string>): Map<string, number> | undefined {
  if (depths.has(types)) return depths.get(types)
  let quoted = false
  for (const type of types.values()) if (type === 'block_quote') { quoted = true; break }
  const cache = quoted ? new Map<string, number>() : undefined
  depths.set(types, cache)
  return cache
}

/** The number of quotes that hold the node at `path`, the node itself left out. */
export function quoteDepth(path: string, types: Map<string, string>): number {
  const cache = depthsOf(types)
  if (cache === undefined) return 0
  const known = cache.get(path)
  if (known !== undefined) return known
  const split = path.lastIndexOf('/children/')
  const parent = split < 0 ? undefined : path.slice(0, split)
  const depth = parent === undefined ? 0 : quoteDepth(parent, types) + (types.get(parent) === 'block_quote' ? 1 : 0)
  cache.set(path, depth)
  return depth
}

const COLON_KINDS: ReadonlySet<string> = new Set(['div', 'directive', 'admonition', 'figure_group', 'line_block'])

function colonKind(type: string, opener: string): string {
  if (type === 'admonition') return 'admonition'
  if (type === 'figure_group') return 'figure group'
  if (type === 'line_block') return 'line block'
  return /^:{3,}[ \t]+\\(?:[ \t]|$)/.test(opener) ? 'hard-break block' : 'div'
}

/** `format`: for a table, a row or a cell, the source format of the table (C2-W-149). */
export interface Walked { node: Node, path: string, parent: string, index: number, format?: string | undefined, quotes?: number }


interface Leaves { type: string[], id: string[], first: boolean[], head: number[], last: number[], start: number[], quotes: number[] }

const blockType = (node: Node): string => (node.type === 'comment' && node.form === 'block' ? 'comment_block' : node.type)

/** The innermost leaf block of each line: later, deeper nodes of the walk overwrite their holders. */
function leaves(walked: readonly Walked[], count: number, chars: Uint32Array): Leaves {
  const out: Leaves = { type: new Array<string>(count).fill('none'), id: new Array<string>(count).fill(''),
    first: new Array<boolean>(count).fill(false), head: new Array<number>(count).fill(0), last: new Array<number>(count).fill(0),
    start: new Array<number>(count).fill(-1), quotes: new Array<number>(count).fill(0) }
  for (const { node, path, quotes } of walked) {
    const type = blockType(node)
    if (!LEAF_TYPES.has(type) || node.pos === undefined) continue
    for (let number = node.pos.startLine; number <= node.pos.endLine; number++) {
      out.type[number - 1] = type
      out.id[number - 1] = path
      out.first[number - 1] = number === node.pos.startLine
      out.head[number - 1] = node.pos.startLine
      out.start[number - 1] = chars[node.pos.startOffset] ?? 0
      out.last[number - 1] = node.pos.endLine
      out.quotes[number - 1] = quotes ?? 0
    }
  }
  return out
}

function ancestorTypes(path: string, types: Map<string, string>): string[] {
  const out: string[] = []
  let current = path
  for (let split = current.lastIndexOf('/children/'); split >= 0; split = current.lastIndexOf('/children/')) {
    current = current.slice(0, split)
    const type = types.get(current)
    if (type !== undefined) out.push(type)
  }
  return out
}

/** The paths of the blocks that hold the node at `path`, innermost first, the document last. */
function ancestorPaths(path: string): string[] {
  const out: string[] = []
  for (let split = path.lastIndexOf('/children/'); split >= 0; split = path.lastIndexOf('/children/')) {
    path = path.slice(0, split)
    out.push(path)
  }
  if (out.at(-1) !== '') out.push('')
  return out
}

interface LineFields {
  number: number, start: number, end: number, text: string, body: string, body_start: number, body_end: number
  blank: boolean, leaf: string, leaf_id: string, leaf_first: boolean, attached_here: boolean, closes_container: boolean
  leaf_head: number, leaf_last: number, leaf_start: number, quote_depth: number
}

class LineRecord {
  readonly number: number
  readonly start: number
  readonly end: number
  readonly text: string
  readonly body: string
  readonly body_start: number
  readonly body_end: number
  readonly blank: boolean
  readonly leaf: string
  readonly leaf_id: string
  readonly leaf_first: boolean
  readonly attached_here: boolean
  readonly closes_container: boolean
  readonly leaf_start: number
  /** The number of quotes that hold the line's leaf. */
  readonly quote_depth: number
  private ancestorsCache: string[] | undefined = undefined
  private idsCache: string[] | undefined = undefined
  private colonCache: ColonContainer[] | undefined = undefined
  private shapeCache: string | undefined = undefined
  private lazyCache: boolean | undefined = undefined
  private readonly leafHead: number
  private readonly leafLast: number
  private readonly path: string
  private readonly index: number
  private readonly model: LineList
  private readonly context: LintContext

  private readonly tables: TableLines

  constructor(fields: LineFields, path: string, index: number, model: LineList, context: LintContext, tables: TableLines) {
    this.number = fields.number
    this.start = fields.start
    this.end = fields.end
    this.text = fields.text
    this.body = fields.body
    this.body_start = fields.body_start
    this.body_end = fields.body_end
    this.blank = fields.blank
    this.leaf = fields.leaf
    this.leaf_id = fields.leaf_id
    this.leaf_first = fields.leaf_first
    this.attached_here = fields.attached_here
    this.closes_container = fields.closes_container
    this.leaf_start = fields.leaf_start
    this.quote_depth = fields.quote_depth
    this.leafHead = fields.leaf_head
    this.leafLast = fields.leaf_last
    this.path = path
    this.index = index
    this.model = model
    this.context = context
    this.tables = tables
  }

  get ancestors(): string[] { return (this.ancestorsCache ??= ancestorTypes(this.path, this.context.nodeTypes as Map<string, string>)) }
  /** The identities of the blocks of `ancestors`, item by item. */
  get ancestor_ids(): string[] { return (this.idsCache ??= this.path === '' ? [] : ancestorPaths(this.path)) }
  get open_colon(): ColonContainer[] { return (this.colonCache ??= openColon(this, this.context)) }
  get quote_marks(): number {
    let marks = 0
    let at = 0
    for (;;) {
      while (this.text[at] === ' ' || this.text[at] === '\t') at++
      if (this.text[at] !== '>' || (at + 1 < this.text.length && this.text[at + 1] !== ' ' && this.text[at + 1] !== '\t')) return marks
      marks++
      at++
    }
  }
  get raw_body(): string {
    const raw = this.context.source.slice(this.start, this.start + this.text.length)
    const from = this.body_start - this.start
    return raw.slice(from, trimEndAt(raw, from))
  }
  get quote_prefix(): boolean { return this.text.slice(0, this.body_start - this.start).includes('>') }
  get shape(): string { return (this.shapeCache ??= shapeOf(this.body)) }
  get lazy(): boolean { return (this.lazyCache ??= isLazy(this, this.context)) }
  get prev(): ModelLine | undefined { return this.model.at(this.index - 1) }
  get prev2(): ModelLine | undefined { return this.model.at(this.index - 2) }
  get next(): ModelLine | undefined { return this.model.at(this.index + 1) }
  get next2(): ModelLine | undefined { return this.model.at(this.index + 2) }
  get leaf_next(): ModelLine | undefined { return this.leafLast === 0 ? this.next : this.model.at(this.leafLast) }
  get leaf_head(): ModelLine | undefined { return this.leafHead === 0 ? undefined : this.model.at(this.leafHead - 1) }
  get table_above(): ModelLine | undefined { return this.model.at(this.tables.aboveOf(this.index)) }
  get table_below(): ModelLine | undefined { return this.model.at(this.tables.belowOf(this.index)) }
  get table_path(): string | undefined { return this.tables.pathOf(this.index) }
}

/** The line records of a document, each made on first read: a document whose rules read few lines makes few. */
class LineList {
  readonly count: number
  private readonly made: (ModelLine | undefined)[]
  private readonly found: Leaves
  private readonly context: LintContext
  private readonly tables: TableLines

  constructor(count: number, found: Leaves, context: LintContext, walked: readonly Walked[]) {
    this.made = new Array<ModelLine | undefined>(count)
    this.count = count
    this.found = found
    this.context = context
    this.tables = new TableLines(pipeTables(walked, context), this)
  }

  at(index: number): ModelLine | undefined {
    if (index < 0 || index >= this.count) return undefined
    return (this.made[index] ??= lineRecord(this.context.lines[index]!, index, this, this.found, this.context, this.tables))
  }

  all(): ModelLine[] {
    const out: ModelLine[] = []
    for (let index = 0; index < this.count; index++) out.push(this.at(index)!)
    return out
  }
}

function lineRecord(line: Line, index: number, model: LineList, found: Leaves, context: LintContext,
  tables: TableLines): ModelLine {
  const leaf = found.type[index]!
  // A verbatim body line keeps quote marks past the quotes that hold its leaf: they are content.
  const marks = VERBATIM_LEAVES.has(leaf) ? found.quotes[index]! : Infinity
  const bodyStart = line.content !== undefined && line.content >= line.start && line.content <= line.end
    ? line.content : quotedStart(line, marks)
  const from = bodyStart - line.start
  const body = line.text.slice(from, trimEndAt(line.text, from))
  return new LineRecord({
    number: line.number, start: line.start, end: line.end, text: line.text,
    body, body_start: bodyStart, body_end: bodyStart + body.length,
    // carve#6196: blank within its containers, so a bare quote mark is a blank line of its quote and `>>` is text.
    blank: leaf === 'none' && body === '', leaf, leaf_id: found.id[index]!, leaf_first: found.first[index]!,
    attached_here: context.state.attachedLines.has(line.number),
    closes_container: context.state.containerClosers.has(line.number),
    leaf_head: found.head[index]!, leaf_last: found.last[index]!, leaf_start: found.start[index]!, quote_depth: found.quotes[index]!,
  }, line.path, index, model, context, tables)
}

const TEXT_LEAVES: ReadonlySet<string> = new Set(['paragraph', 'caption', 'definition_term', 'heading', 'line', 'table_cell'])

function quoteMarks(line: ModelLine): number {
  let marks = 0
  let at = 0
  for (;;) {
    while (line.text[at] === ' ' || line.text[at] === '\t') at++
    if (line.text[at] !== '>' || (at + 1 < line.text.length && line.text[at + 1] !== ' ')) return marks
    marks++
    at++
  }
}

/** C2-B-024: a later line of a text leaf that lacks a quote mark or the indent of a container that holds the leaf. */
function isLazy(line: ModelLine, context: LintContext): boolean {
  if (!TEXT_LEAVES.has(line.leaf) || line.leaf_first) return false
  const marks = quoteMarks(line)
  if (marks < line.quote_depth) return true
  for (let path = line.leaf_id, split = path.lastIndexOf('/children/'); split >= 0; split = path.lastIndexOf('/children/')) {
    path = path.slice(0, split)
    const content = context.layouts.get(path)?.contentColumn
    if (content !== undefined) return columnOf(context.source, line.body_start, marks) < content
  }
  return false
}

/** The owner of a block: its parent, a description list skipped, since its terms and descriptions own their lines. */
function ownerOf(parent: string, types: Map<string, string>): { path: string, type: string } {
  let path = parent
  let type = types.get(path) ?? 'document'
  while (type === 'definition_list' && path !== '') {
    const split = path.lastIndexOf('/children/')
    path = split < 0 ? '' : path.slice(0, split)
    type = types.get(path) ?? 'document'
  }
  return { path, type }
}

const COLON_CONTAINERS: ReadonlySet<string> = new Set(['admonition', 'directive', 'div', 'figure_group'])

/** carve#6206: the list item that is the owner, or holds it through colon containers only; else the document. */
export function itemOwnerOf(owner: { path: string, type: string }, types: Map<string, string>): { path: string, type: string } {
  let cache = itemOwners.get(types)
  if (cache === undefined) itemOwners.set(types, cache = new Map())
  const known = cache.get(owner.path)
  if (known !== undefined) return known
  let { path, type } = owner
  const visited: string[] = []
  while (COLON_CONTAINERS.has(type) && path !== '') {
    visited.push(path)
    const split = path.lastIndexOf('/children/')
    path = split < 0 ? '' : path.slice(0, split)
    type = types.get(path) ?? 'document'
    const found = cache.get(path)
    if (found !== undefined) {
      for (const at of visited) cache.set(at, found)
      return found
    }
  }
  const result = type === 'list_item' ? { path, type } : { path: '', type: 'document' }
  cache.set(path, result)
  for (const at of visited) cache.set(at, result)
  return result
}

const itemOwners = new WeakMap<Map<string, string>, Map<string, { path: string, type: string }>>()

/** A container as a block record sees it; its content column is computed on first read and shared per path. */
class ContainerRecord implements Container {
  readonly type: string
  private readonly path: string
  private readonly quotes: () => number
  private readonly context: LintContext
  private readonly contents: Map<string, number>

  constructor(path: string, type: string, quotes: () => number, context: LintContext, contents: Map<string, number>) {
    this.path = path
    this.type = type
    this.quotes = quotes
    this.context = context
    this.contents = contents
  }

  get content_column(): number {
    const quotes = this.quotes()
    const key = `${quotes}:${this.path}`
    let found = this.contents.get(key)
    if (found === undefined) {
      found = ownerContent(this.type, this.context.layouts.get(this.path), quotes, this.context)
      this.contents.set(key, found)
    }
    return found
  }

  get marker_column(): number | undefined { return this.context.layouts.get(this.path)?.markerColumn }
}

class BlockRecord {
  private ancestorsCache: string[] | undefined = undefined
  private ancestorIdsCache: string[] | undefined = undefined
  private quotes: number | undefined = undefined
  private columnCache: number | undefined = undefined
  private ownerCache: Container | undefined = undefined
  private itemOwnerCache: Container | undefined = undefined
  private readonly format: string | undefined
  private parentCache: Container | undefined = undefined
  readonly type: string
  readonly path: string
  readonly start: number
  readonly index: number
  readonly line: ModelLine
  readonly node: Node
  private readonly parentPath: string
  private readonly context: LintContext

  private readonly containers: Map<string, number>

  private readonly lines: LineList

  private readonly spanEnd: number | undefined

  constructor(item: Walked, line: ModelLine, start: number, context: LintContext, containers: Map<string, number>, lines: LineList,
    end?: number) {
    this.spanEnd = end
    this.containers = containers
    this.lines = lines
    this.node = item.node
    this.type = blockType(item.node)
    this.path = item.path
    this.format = item.format
    this.parentPath = item.parent
    this.start = start
    this.index = item.index
    this.line = line
    this.context = context
  }

  get attributed(): boolean { return this.node.attrs !== undefined }
  get ancestors(): string[] { return (this.ancestorsCache ??= ancestorTypes(this.path, this.context.nodeTypes as Map<string, string>)) }
  get ancestor_ids(): string[] { return (this.ancestorIdsCache ??= ancestorPaths(this.path)) }
  /** The identity of the block, as ancestor_ids gives the identities of the blocks that hold it. */
  get identity(): string { return this.path }
  /** C2-L-009: the layout entry of the block, absent where the layout has none. */
  get layout(): NodeLayout | undefined { return this.context.layouts.get(this.path) }
  get end(): number { return this.spanEnd ?? this.context.chars[this.node.pos?.endOffset ?? 0] ?? this.context.source.length }
  get text(): string { return this.context.source.slice(this.start, this.end) }
  get last_line(): ModelLine {
    const number = this.spanEnd === undefined
      ? this.node.pos?.endLine ?? 1
      : this.context.offsetLines[Math.max(this.start, this.spanEnd - 1)] ?? 1
    return this.lines.at(number - 1) ?? this.line
  }
  get prev_type(): string | undefined {
    const split = this.path.lastIndexOf('/')
    return this.index === 0 || split < 0 ? undefined : this.context.nodeTypes.get(`${this.path.slice(0, split)}/${this.index - 1}`)
  }
  get image_line(): boolean {
    return this.node.type === 'paragraph' && this.node.children.length === 1 && this.node.children[0]?.type === 'image'
  }
  private depth(): number { return (this.quotes ??= quoteDepth(this.path, this.context.nodeTypes as Map<string, string>)) }
  private container(at: string, type: string): Container {
    return new ContainerRecord(at, type, () => this.depth(), this.context, this.containers)
  }
  get column(): number { return (this.columnCache ??= columnOf(this.context.source, this.start, this.depth())) }
  get opener_column(): number {
    const marker = this.context.layouts.get(this.path)?.markerColumn
    return marker !== undefined && this.node.attrs === undefined ? marker : this.column
  }
  get opener_start(): number {
    return this.node.attrs === undefined ? this.start : openerStart(this.context.source, this.start, this.depth())
  }
  get mark_column(): number {
    return this.node.attrs === undefined ? this.column : columnOf(this.context.source, this.opener_start, this.depth())
  }
  get opener_text(): string {
    const source = this.context.source
    const from = this.opener_start
    const end = source.indexOf('\n', from)
    // A scan from the end: /[ \t\r]+$/ retries from every character of a run that text follows, which is quadratic.
    let to = end < 0 ? source.length : end
    while (to > from && (source[to - 1] === ' ' || source[to - 1] === '\t' || source[to - 1] === '\r')) to--
    return source.slice(from, to)
  }
  get after_quote_mark(): boolean {
    const at = this.opener_start
    const source = this.context.source
    return source.slice(source.lastIndexOf('\n', at - 1) + 1, at).endsWith('> ')
  }
  get owner(): Container {
    if (this.ownerCache === undefined) {
      const found = ownerOf(this.parentPath, this.context.nodeTypes as Map<string, string>)
      this.ownerCache = this.container(found.path, found.type)
    }
    return this.ownerCache
  }
  get item_owner(): Container {
    if (this.itemOwnerCache === undefined) {
      const types = this.context.nodeTypes as Map<string, string>
      const found = itemOwnerOf(ownerOf(this.parentPath, types), types)
      this.itemOwnerCache = this.container(found.path, found.type)
    }
    return this.itemOwnerCache
  }
  get source_format(): string | undefined { return this.format }
  get group(): string | undefined { return groupOf(this.type, this.path, this.context) }
  get row_index(): number | undefined { return rowIndexOf(this.type, this.path, this.context) }
  get parent(): Container {
    return (this.parentCache ??= this.container(this.parentPath, this.context.nodeTypes.get(this.parentPath) ?? 'document'))
  }
}


const INLINE_LEAVES: ReadonlySet<string> = new Set(['paragraph', 'caption', 'definition_term', 'heading', 'line', 'cell_paragraph'])

const INLINE_PARENT_TYPES: ReadonlySet<string> = new Set(INLINE_PARENTS)

class InlineRecord implements ModelInline {
  readonly type: string
  readonly path: string
  readonly start: number
  readonly end: number
  readonly leaf: string
  readonly parent: string
  readonly node: Node
  private readonly source: string
  private readonly layouts: LintContext['layouts']

  constructor(node: Node, path: string, leaf: string, parent: string, context: LintContext) {
    this.node = node
    this.layouts = context.layouts
    this.type = node.type
    this.path = path
    this.start = context.chars[node.pos?.startOffset ?? 0] ?? 0
    this.end = context.chars[node.pos?.endOffset ?? 0] ?? context.source.length
    this.leaf = leaf
    this.parent = parent
    this.source = context.source
  }

  get text(): string { return this.source.slice(this.start, this.end) }

  /** C2-L-022: the reference of a link or an image, read without the container prefixes of the lines it crosses. */
  get raw_ref(): string { return this.layouts.get(this.path)?.rawRef ?? this.text }
}

/** An id record: one distinct id that the tree carries, in order of first occurrence. */
export interface ModelId {
  readonly type: 'id'
  readonly id: string
  /** C2-A-039: the type of the first node that carries the id, the one it anchors. */
  readonly owner: string
  readonly index: number
  readonly start: number
}

/** A text run record: the text and soft breaks that stand next to each other among the children of one inline parent. */
class TextRunRecord implements ModelInline {
  readonly type = 'text_run'
  readonly node = undefined
  readonly path: string
  readonly start: number
  end: number
  readonly leaf: string
  readonly parent: string
  next: number
  private readonly source: string

  constructor(path: string, start: number, end: number, next: number, leaf: string, parent: string, source: string) {
    this.path = path
    this.start = start
    this.end = end
    this.next = next
    this.leaf = leaf
    this.parent = parent
    this.source = source
  }

  get text(): string { return this.source.slice(this.start, this.end) }
}

/**
 * The block records and inline records, collected during the lint visit so the tree is walked once: `child` is called
 * for every node in visit order, a parent before its children.
 */
export class DataWalk {
  readonly walked: Walked[] = []
  readonly inline: ModelInline[] = []
  /** The nodes that carry `attrs`, when an attribute rule is on (C2-W-148), with their paths and whether they are inline. */
  readonly attributed: Attributed = { nodes: [], paths: [], inline: [] }
  readonly ids: ModelId[] = []
  private readonly idIndex = new Map<string, ModelId>()
  private holder: { path: string, type: string, inline: boolean } | undefined = undefined
  // The blocks the walk is inside, with the quotes that hold each: it visits a parent before its children.
  private readonly openBlocks: Node[] = []
  private readonly openQuotes: number[] = []
  private tableFormat: string | undefined = undefined
  private readonly types: ReadonlySet<string>
  private readonly context: LintContext
  private readonly textRuns: boolean
  // Visit order is depth first, so a run can only go on at the next sibling of its last node: one run is open at a time.
  private open: TextRunRecord | undefined = undefined

  private readonly attributes: boolean
  private readonly model: boolean

  /** `model`: whether the line model is built, which reads the block nodes of the walk. */
  constructor(document: Node, types: ReadonlySet<string>, context: LintContext, attributes = false, model = true) {
    this.types = types
    this.textRuns = types.has('text_run')
    this.context = context
    this.attributes = attributes
    this.model = model
    this.walked.push({ node: document, path: '', parent: '', index: 0 })
    this.id(document)
  }

  /** The ids a node carries: an authored id, then a generated heading id. */
  private id(node: Node): void {
    const authored = node.attrs?.id
    if (authored !== undefined) this.addId(authored, node)
    if (node.type === 'heading' && node.generatedId !== undefined) this.addId(node.generatedId, node)
  }

  private addId(id: string, node: Node): void {
    if (this.idIndex.has(id)) return
    const start = node.pos === undefined ? 0 : this.context.chars[node.pos.startOffset] ?? 0
    const record: ModelId = { type: 'id', id, owner: node.type, index: this.ids.length, start }
    this.idIndex.set(id, record)
    this.ids.push(record)
  }

  /** C2-W-140: a text or soft break child of an inline parent joins the run of its previous sibling, or starts one. */
  private run(node: Node, parent: Node, parentPath: string, index: number, leaf: string): void {
    if (node.type !== 'text' && node.type !== 'soft_break') {
      this.open = undefined
      return
    }
    if (!INLINE_PARENT_TYPES.has(parent.type)) return
    const open = this.open
    const joins = open !== undefined && open.next === index && open.path === parentPath
    if (node.pos === undefined) {
      if (joins) open.next = index + 1
      return
    }
    const start = this.context.chars[node.pos.startOffset] ?? 0
    const end = this.context.chars[node.pos.endOffset] ?? this.context.source.length
    if (joins) {
      open.end = end
      open.next = index + 1
      return
    }
    const record = new TextRunRecord(parentPath, start, end, index + 1, leaf, parent.type, this.context.source)
    this.open = record
    this.inline.push(record)
  }

  // C2-B-227: a table may have consumed every key it took.
  private attribute(node: Node, path: string, parent: Node): void {
    if (node.attrs === undefined && node.type !== 'table') return
    this.attributed.nodes.push(node)
    this.attributed.paths.push(path)
    this.attributed.inline.push(INLINE_PARENT_TYPES.has(parent.type))
  }

  // A table's rows and cells follow it in the walk, and a cell holds no table.
  private formatOf(node: Node, path: string): string | undefined {
    if (node.type === 'table') return (this.tableFormat = this.context.layouts.get(path)?.sourceFormat)
    return node.type === 'table_row' || node.type === 'table_cell' ? this.tableFormat : undefined
  }

  private inlineChild(node: Node, path: string, parent: Node, parentPath: string, index: number, leaf: string): void {
    if ((this.types.has(node.type) || this.types.has('*')) && node.pos !== undefined) {
      this.inline.push(new InlineRecord(node, path, leaf, parent.type, this.context))
    }
    if (this.textRuns) this.run(node, parent, parentPath, index, leaf)
  }

  private quotesOf(node: Node, parent: Node): number {
    while (this.openBlocks.length > 0 && this.openBlocks[this.openBlocks.length - 1] !== parent) {
      this.openBlocks.pop()
      this.openQuotes.pop()
    }
    const quotes = (this.openQuotes[this.openQuotes.length - 1] ?? 0) + (parent.type === 'block_quote' ? 1 : 0)
    this.openBlocks.push(node)
    this.openQuotes.push(quotes)
    return quotes
  }

  child(node: Node, path: string, parent: Node, parentPath: string, index: number): void {
    if (this.attributes) this.attribute(node, path, parent)
    if (!this.model) return
    if (node.attrs?.id !== undefined || node.type === 'heading') this.id(node)
    const holder = this.holder
    // Inline content holds no block and no line of its own; the caption of an image paragraph is a block (C2-W-140).
    if (holder !== undefined && node.type !== 'caption' && path.charCodeAt(holder.path.length) === 47 && path.startsWith(holder.path)) {
      if (holder.inline) this.inlineChild(node, path, parent, parentPath, index, holder.type)
      return
    }
    if (this.textRuns) this.run(node, parent, parentPath, index, blockType(parent))
    this.walked.push({ node, path, parent: parentPath, index, format: this.formatOf(node, path), quotes: this.quotesOf(node, parent) })
    this.holder = INLINE_HOLDERS.has(node.type) ? { path, type: node.type, inline: INLINE_LEAVES.has(node.type) } : undefined
  }
}

// C2-W-140: every block has a record; a row a continuation joined has no `pos` (C2-A-158), so its layout gives the span.
function blockSpan(item: Walked, context: LintContext): { start: number, end: number | undefined } | undefined {
  if (item.node.pos !== undefined) return { start: context.chars[item.node.pos.startOffset] ?? 0, end: undefined }
  const layout = context.layouts.get(item.path)
  if (layout === undefined) return undefined
  return { start: context.chars[layout.startByte] ?? 0, end: context.chars[layout.endByte] ?? context.source.length }
}

// A lookup that names no block types reads every block.
const isNeeded = (needed: ReadonlySet<string>, type: string): boolean => needed.has(type) || needed.has('*')

/** The model; a block record is made only where `runsFor` gives runs for its type and its parent's type, or a lookup needs it. */
export function buildModel<T>(walked: readonly Walked[], context: LintContext,
  runsFor: (type: string, parent: string) => readonly T[], needed: ReadonlySet<string> = new Set()): LineModel<T> {
  const { source, lines } = context
  const found = leaves(walked, lines.length, context.chars)
  // C2-B-010: the empty rest after the last line terminator is no line.
  const count = lines.length > 1 && lines[lines.length - 1]!.text === '' && source.endsWith('\n') ? lines.length - 1 : lines.length
  const model = new LineList(count, found, context, walked)
  const blocks: ModelBlock[] = []
  const runs: (readonly T[])[] = []
  const containers = new Map<string, number>()
  for (const item of walked) {
    if (item.path === '') continue
    const blockRuns = runsFor(blockType(item.node), context.nodeTypes.get(item.parent) ?? 'document')
    if (blockRuns.length === 0 && !isNeeded(needed, blockType(item.node))) continue
    const span = blockSpan(item, context)
    const line = span === undefined ? undefined : model.at((context.offsetLines[span.start] ?? 1) - 1)
    if (line === undefined) continue
    blocks.push(new BlockRecord(item, line, span!.start, context, containers, model, span!.end))
    runs.push(blockRuns)
  }
  // A getter in this literal gives every call its own hidden class in old space, which keeps the call's records alive
  // through young collections.
  return { lines: model, blocks, runs }
}

function ownerContent(type: string, layout: NodeLayout | undefined, quotes: number, context: LintContext): number {
  if (type === 'block_quote' || type === 'document') return 0
  if (layout?.contentColumn !== undefined) return layout.contentColumn
  if (layout === undefined) return 0
  return columnOf(context.source, context.chars[layout.startByte] ?? 0, quotes)
}

function childCovers(path: string, start: number, end: number, context: LintContext): boolean {
  for (const [childPath, child] of context.layouts) {
    if (!childPath.startsWith(`${path}/`)) continue
    if ((context.chars[child.startByte] ?? 0) <= start && (context.chars[child.endByte] ?? 0) >= end) return true
  }
  return false
}

function earlierCloser(path: string, layout: NodeLayout, width: number, context: LintContext): boolean {
  if (layout.closerRaw !== undefined) return layout.closerRaw !== ''
  const from = context.chars[layout.startByte] ?? 0
  const to = context.chars[layout.endByte] ?? 0
  const first = context.offsetLines[from] ?? 1
  const last = context.offsetLines[Math.max(from, to - 1)] ?? first
  for (let number = first + 1; number <= last; number++) {
    const line = context.lines[number - 1]
    if (line === undefined) break
    const start = quotedStart(line)
    const text = line.text.slice(start - line.start).trimEnd()
    if (!/^:{3,}$/.test(text) || text.length < width || start + text.length > to) continue
    if (!childCovers(path, start, start + text.length, context)) return true
  }
  return false
}

interface ColonLayout {
  path: string, layout: NodeLayout, type: string, from: number, to: number, width: number, owner?: string, closed?: boolean
}

const colonLayouts = new WeakMap<LintContext['layouts'], ColonLayout[]>()

/** The layouts of colon containers, whose opener is a run of three or more colons, in layout order. */
function colonLayoutsOf(context: LintContext): ColonLayout[] {
  let found = colonLayouts.get(context.layouts)
  if (found !== undefined) return found
  found = []
  for (const [path, layout] of context.layouts) {
    const type = context.nodeTypes.get(path)
    if (type === undefined || !COLON_KINDS.has(type)) continue
    const from = openerStart(context.source, context.chars[layout.startByte] ?? 0)
    let width = 0
    while (context.source.charCodeAt(from + width) === 58) width++
    if (width >= 3) found.push({ path, layout, type, from, to: context.chars[layout.endByte] ?? 0, width })
  }
  colonLayouts.set(context.layouts, found)
  return found
}

/** The opener of a block whose source starts at its attached attribute lines: past them and the next line's prefixes. */
function openerStart(source: string, from: number, marks = Infinity): number {
  let at = from
  while (source.charCodeAt(at) === 123) {
    const end = source.indexOf('\n', at)
    if (end < 0) return from
    at = end + 1
    while (source.charCodeAt(at) === 32 || source.charCodeAt(at) === 9) at++
    // Only the marks of the quotes that hold the block: a quote's own mark is its opener.
    for (let left = marks; left > 0 && source.charCodeAt(at) === 62; left--) {
      at++
      while (source.charCodeAt(at) === 32 || source.charCodeAt(at) === 9) at++
    }
  }
  return at
}

function colonOpener(colon: ColonLayout, at: number, lineStart: number, context: LintContext): ColonContainer | undefined {
  const { path, layout, type, from, to, width } = colon
  if (from >= at) return undefined
  // A container without a closer of its own stays open across the blank lines after its last block.
  if (to < lineStart - 1 && blankFrom(context, lineStart) > to) return undefined
  if (to < lineStart && (colon.closed ??= earlierCloser(path, layout, width, context))) return undefined
  return colonEntry(type, from, width, context)
}

const blankStarts = new WeakMap<LintContext['layouts'], Uint32Array>()

/** Where the run of spaces, tabs, line ends and quote marks that ends at `end` starts. */
function blankFrom(context: LintContext, end: number): number {
  let starts = blankStarts.get(context.layouts)
  if (starts === undefined) {
    const source = context.source
    starts = new Uint32Array(source.length + 1)
    for (let at = 1; at <= source.length; at++) {
      const code = source.charCodeAt(at - 1)
      starts[at] = code === 32 || code === 9 || code === 13 || code === 10 || code === 62 ? starts[at - 1]! : at
    }
    blankStarts.set(context.layouts, starts)
  }
  return starts[end]!
}

/** The candidates of a line: the first `length` entries of `list`, which later lines only append to. */
interface Candidates { list: ColonLayout[], length: number }

const colonCandidates = new WeakMap<LintContext['layouts'], Candidates[]>()

/**
 * The colon containers that may be open on each line, by line number: those that start before the line ends and end
 * at or after the blank run before the line. A container that ends before that run never is again, so one sweep
 * over the lines finds them all (carve-js#5280).
 */
function colonCandidatesOf(context: LintContext): Candidates[] {
  let table = colonCandidates.get(context.layouts)
  if (table !== undefined) return table
  const colons = [...colonLayoutsOf(context)].sort((a, b) => a.from - b.from)
  table = []
  let active: ColonLayout[] = []
  let next = 0
  for (const line of context.lines) {
    while (next < colons.length && colons[next]!.from <= line.end) active.push(colons[next++]!)
    const bound = Math.min(line.start - 1, blankFrom(context, line.start))
    // A line keeps the list it saw, so a list that loses an entry is copied rather than changed.
    if (active.some((colon) => colon.to < bound)) active = active.filter((colon) => colon.to >= bound)
    table[line.number] = { list: active, length: active.length }
  }
  colonCandidates.set(context.layouts, table)
  return table
}

function colonEntry(type: string, from: number, width: number, context: LintContext): ColonContainer {
  const number = context.offsetLines[from] ?? 1
  const opened = context.lines[number - 1]
  return { width, line: number, column: from - (opened?.start ?? from) + 1, start: from,
    kind: colonKind(type, opened?.text.slice(from - opened.start) ?? '') }
}

const OWNER_BOUNDARIES: ReadonlySet<string> = new Set(['block_quote', 'list_item', 'footnote', 'definition_description'])

interface Owner { path: string, from: number, to: number, parent: number }

const owners = new WeakMap<LintContext['layouts'], Owner[]>()

/**
 * The owners by start, each with the nearest earlier one that covers it: the sources of blocks nest, so the owners
 * that cover a point are the last one that starts at or before it and those it lies in.
 */
function ownersOf(context: LintContext): Owner[] {
  let list = owners.get(context.layouts)
  if (list !== undefined) return list
  list = []
  for (const [path, layout] of context.layouts) {
    if (!OWNER_BOUNDARIES.has(context.nodeTypes.get(path) ?? '')) continue
    list.push({ path, from: context.chars[layout.startByte] ?? 0, to: context.chars[layout.endByte] ?? 0, parent: -1 })
  }
  list.sort((a, b) => a.from - b.from || b.to - a.to || a.path.length - b.path.length)
  const open: number[] = []
  for (let index = 0; index < list.length; index++) {
    const owner = list[index]!
    while (open.length > 0 && list[open.at(-1)!]!.to < owner.to) open.pop()
    owner.parent = open.at(-1) ?? -1
    open.push(index)
  }
  owners.set(context.layouts, list)
  return list
}

/** The path of the innermost quote, item, footnote or description whose source covers `at`, or `undefined`. */
function ownerBoundary(at: number, context: LintContext): string | undefined {
  const list = ownersOf(context)
  let low = 0
  let high = list.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (list[middle]!.from <= at) low = middle + 1
    else high = middle
  }
  let found: string | undefined
  for (let index = low - 1; index >= 0; index = list[index]!.parent) {
    const { path, from, to } = list[index]!
    if (from <= at && at < to && (found === undefined || path.length > found.length)) found = path
  }
  return found
}

/** carve#6194: a run is compared only with the colon containers of its own innermost owner (C2-B-109). */
function openColon(line: ModelLine, context: LintContext): ColonContainer[] {
  const open: ColonContainer[] = []
  const boundary = ownerBoundary(line.body_start, context)
  const candidates = colonCandidatesOf(context)[line.number]
  const list = candidates?.list ?? colonLayoutsOf(context)
  const length = candidates?.length ?? list.length
  for (let index = 0; index < length; index++) {
    const colon = list[index]!
    if ((colon.owner ??= ownerBoundary(colon.from, context) ?? '') !== (boundary ?? '')) continue
    const found = colonOpener(colon, line.body_start, line.start, context)
    if (found !== undefined) open.push(found)
  }
  return open.sort((a, b) => b.start - a.start)
}
