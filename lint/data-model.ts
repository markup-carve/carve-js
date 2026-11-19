import { forEachSlot, type Node, SOURCE_ORDER } from '../src/ast.ts'
import { columnOf } from '../src/layout-lines.ts'
import { type NodeLayout } from '../src/layout.ts'
import { isAttributeLine } from '../src/lines.ts'
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
  attribute_line: boolean
  closes_container: boolean
  readonly ancestors: string[]
  readonly open_colon: ColonContainer[]
  readonly prev: ModelLine | undefined
  readonly prev2: ModelLine | undefined
  readonly next: ModelLine | undefined
  readonly next2: ModelLine | undefined
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
  line: ModelLine
  readonly owner: Container
  readonly parent: Container
}

export interface Container { type: string, content_column: number, marker_column: number | undefined }

export interface LineModel {
  lines: ModelLine[]
  blocks: ModelBlock[]
}

const INLINE_HOLDERS: ReadonlySet<string> = new Set(['paragraph', 'caption', 'definition_term', 'heading', 'line',
  'cell_paragraph', 'code_block', 'raw_block', 'frontmatter', 'comment', 'include'])

const LEAF_TYPES: ReadonlySet<string> = new Set(['paragraph', 'caption', 'definition_term', 'heading', 'line', 'table_cell',
  'table_row', 'code_block', 'raw_block', 'frontmatter', 'comment_block'])

function trimmedStart(line: Line): number {
  let at = 0
  while (line.text[at] === ' ' || line.text[at] === '\t') at++
  return line.start + at
}

/** Behind leading spaces and tabs and every quote mark followed by a space. */
function quotedStart(line: Line): number {
  let at = trimmedStart(line) - line.start
  while (line.text.startsWith('> ', at)) {
    at += 2
    while (line.text[at] === ' ' || line.text[at] === '\t') at++
  }
  return line.start + at
}

function trimEndAt(text: string): number {
  let end = text.length
  while (end > 0 && (text[end - 1] === ' ' || text[end - 1] === '\t')) end--
  return end
}

const depths = new WeakMap<Map<string, string>, Map<string, number>>()

/** The number of quotes that hold the node at `path`, the node itself left out. */
function quoteDepth(path: string, types: Map<string, string>): number {
  let cache = depths.get(types)
  if (cache === undefined) {
    cache = new Map<string, number>()
    depths.set(types, cache)
  }
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

interface Walked { node: Node, path: string, parent: string, index: number }

function walk(document: Node): Walked[] {
  const out: Walked[] = []
  const visit = (node: Node, path: string, parent: string, index: number): void => {
    out.push({ node, path, parent, index })
    // Inline content holds no block and no line of its own.
    if (INLINE_HOLDERS.has(node.type)) return
    forEachSlot(node, (nodes, step, single) => {
      if (single) {
        const child = nodes[0]
        if (child !== undefined) visit(child, `${path}/${step}`, path, 0)
      } else {
        for (let at = 0; at < nodes.length; at++) {
          const child = nodes[at]
          if (child !== undefined) visit(child, `${path}/${step}/${at}`, path, at)
        }
      }
    }, SOURCE_ORDER)
  }
  visit(document, '', '', 0)
  return out
}

interface Leaves { type: string[], id: string[], first: boolean[] }

const blockType = (node: Node): string => (node.type === 'comment' && node.form === 'block' ? 'comment_block' : node.type)

/** The innermost leaf block of each line: later, deeper nodes of the walk overwrite their holders. */
function leaves(walked: readonly Walked[], count: number): Leaves {
  const out: Leaves = { type: new Array<string>(count).fill('none'), id: new Array<string>(count).fill(''),
    first: new Array<boolean>(count).fill(false) }
  for (const { node, path } of walked) {
    const type = blockType(node)
    if (!LEAF_TYPES.has(type) || node.pos === undefined) continue
    for (let number = node.pos.startLine; number <= node.pos.endLine; number++) {
      out.type[number - 1] = type
      out.id[number - 1] = path
      out.first[number - 1] = number === node.pos.startLine
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

interface LineFields {
  number: number, start: number, end: number, text: string, body: string, body_start: number, body_end: number
  blank: boolean, leaf: string, leaf_id: string, leaf_first: boolean, attached_here: boolean, attribute_line: boolean
  closes_container: boolean
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
  readonly attribute_line: boolean
  readonly closes_container: boolean
  private ancestorsCache: string[] | undefined = undefined
  private colonCache: ColonContainer[] | undefined = undefined
  private readonly path: string
  private readonly index: number
  private readonly model: ModelLine[]
  private readonly context: LintContext

  constructor(fields: LineFields, path: string, index: number, model: ModelLine[], context: LintContext) {
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
    this.attribute_line = fields.attribute_line
    this.closes_container = fields.closes_container
    this.path = path
    this.index = index
    this.model = model
    this.context = context
  }

  get ancestors(): string[] { return (this.ancestorsCache ??= ancestorTypes(this.path, this.context.nodeTypes as Map<string, string>)) }
  get open_colon(): ColonContainer[] { return (this.colonCache ??= openColon(this, this.context)) }
  get prev(): ModelLine | undefined { return this.model[this.index - 1] }
  get prev2(): ModelLine | undefined { return this.model[this.index - 2] }
  get next(): ModelLine | undefined { return this.model[this.index + 1] }
  get next2(): ModelLine | undefined { return this.model[this.index + 2] }
}

function lineRecord(line: Line, index: number, model: ModelLine[], found: Leaves, context: LintContext): ModelLine {
  const bodyStart = line.content !== undefined && line.content >= line.start && line.content <= line.end
    ? line.content : quotedStart(line)
  const rest = line.text.slice(bodyStart - line.start)
  const body = rest.slice(0, trimEndAt(rest))
  const leaf = found.type[index]!
  return new LineRecord({
    number: line.number, start: line.start, end: line.end, text: line.text,
    body, body_start: bodyStart, body_end: bodyStart + body.length,
    blank: leaf === 'none' && /^[\s>]*$/.test(line.text), leaf, leaf_id: found.id[index]!, leaf_first: found.first[index]!,
    attached_here: context.state.attachedLines.has(line.number),
    attribute_line: body.startsWith('{') && isAttributeLine(body, 0, body.length),
    closes_container: context.state.containerClosers.has(line.number),
  }, line.path, index, model, context)
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

class BlockRecord {
  private quotes: number | undefined = undefined
  private columnCache: number | undefined = undefined
  private ownerCache: Container | undefined = undefined
  private parentCache: Container | undefined = undefined
  readonly type: string
  readonly path: string
  readonly start: number
  readonly index: number
  readonly line: ModelLine
  private readonly node: Node
  private readonly parentPath: string
  private readonly context: LintContext

  constructor(item: Walked, line: ModelLine, start: number, context: LintContext) {
    this.node = item.node
    this.type = blockType(item.node)
    this.path = item.path
    this.parentPath = item.parent
    this.start = start
    this.index = item.index
    this.line = line
    this.context = context
  }

  get attributed(): boolean { return this.node.attrs !== undefined }
  get image_line(): boolean {
    return this.node.type === 'paragraph' && this.node.children.length === 1 && this.node.children[0]?.type === 'image'
  }
  private depth(): number { return (this.quotes ??= quoteDepth(this.path, this.context.nodeTypes as Map<string, string>)) }
  private container(at: string, type: string): Container {
    const layout = this.context.layouts.get(at)
    return { type, content_column: ownerContent(type, layout, this.depth(), this.context), marker_column: layout?.markerColumn }
  }
  get column(): number { return (this.columnCache ??= columnOf(this.context.source, this.start, this.depth())) }
  get opener_column(): number {
    const marker = this.context.layouts.get(this.path)?.markerColumn
    return marker !== undefined && this.node.attrs === undefined ? marker : this.column
  }
  get after_quote_mark(): boolean { return this.context.source.slice(this.line.start, this.start).endsWith('> ') }
  get owner(): Container {
    if (this.ownerCache === undefined) {
      const found = ownerOf(this.parentPath, this.context.nodeTypes as Map<string, string>)
      this.ownerCache = this.container(found.path, found.type)
    }
    return this.ownerCache
  }
  get parent(): Container {
    return (this.parentCache ??= this.container(this.parentPath, this.context.nodeTypes.get(this.parentPath) ?? 'document'))
  }
}

function blockRecord(item: Walked, line: ModelLine, start: number, context: LintContext): ModelBlock {
  return new BlockRecord(item, line, start, context)
}

export function buildModel(document: Node, context: LintContext): LineModel {
  const { source, lines } = context
  const walked = walk(document)
  const found = leaves(walked, lines.length)
  // C2-B-010: the empty rest after the last line terminator is no line.
  const count = lines.length > 1 && lines[lines.length - 1]!.text === '' && source.endsWith('\n') ? lines.length - 1 : lines.length
  const model: ModelLine[] = []
  for (let index = 0; index < count; index++) model.push(lineRecord(lines[index]!, index, model, found, context))
  const blocks: ModelBlock[] = []
  for (const item of walked) {
    if (item.path === '' || item.node.pos === undefined) continue
    const start = context.chars[item.node.pos.startOffset] ?? 0
    const line = model[(context.offsetLines[start] ?? 1) - 1]
    if (line !== undefined) blocks.push(blockRecord(item, line, start, context))
  }
  return { lines: model, blocks }
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

function colonOpener(path: string, layout: NodeLayout, at: number, context: LintContext): ColonContainer | undefined {
  const from = context.chars[layout.startByte] ?? 0
  const to = context.chars[layout.endByte] ?? 0
  if (from >= at || to < at - 1) return undefined
  let width = 0
  while (context.source.charCodeAt(from + width) === 58) width++
  if (width < 3) return undefined
  const type = context.nodeTypes.get(path)
  if (type === undefined || !COLON_KINDS.has(type)) return undefined
  if (to < at && earlierCloser(path, layout, width, context)) return undefined
  return colonEntry(type, from, width, context)
}

function colonEntry(type: string, from: number, width: number, context: LintContext): ColonContainer {
  const number = context.offsetLines[from] ?? 1
  const opened = context.lines[number - 1]
  return { width, line: number, column: from - (opened?.start ?? from) + 1, start: from,
    kind: colonKind(type, opened?.text.slice(from - opened.start) ?? '') }
}

function openColon(line: ModelLine, context: LintContext): ColonContainer[] {
  const open: ColonContainer[] = []
  for (const [path, layout] of context.layouts) {
    const found = colonOpener(path, layout, line.body_start, context)
    if (found !== undefined) open.push(found)
  }
  return open.sort((a, b) => b.start - a.start)
}
