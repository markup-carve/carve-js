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
  column: number
  opener_column: number
  attributed: boolean
  image_line: boolean
  index: number
  after_quote_mark: boolean
  line: ModelLine
  owner: Container
  parent: Container
}

export interface Container { type: string, content_column: number, marker_column: number | undefined }

export interface LineModel {
  lines: ModelLine[]
  blocks: ModelBlock[]
}

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

function quoteDepth(path: string, types: Map<string, string>): number {
  let depth = 0
  for (let split = path.lastIndexOf('/children/'); split > 0; split = path.lastIndexOf('/children/', split - 1)) {
    if (types.get(path.slice(0, split)) === 'block_quote') depth++
  }
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

function lineRecord(line: Line, index: number, model: ModelLine[], found: Leaves, context: LintContext): ModelLine {
  const bodyStart = line.content !== undefined && line.content >= line.start && line.content <= line.end
    ? line.content : quotedStart(line)
  const rest = line.text.slice(bodyStart - line.start)
  const body = rest.slice(0, trimEndAt(rest))
  let ancestors: string[] | undefined
  let colon: ColonContainer[] | undefined
  const record: ModelLine = {
    number: line.number, start: line.start, end: line.end, text: line.text,
    body, body_start: bodyStart, body_end: bodyStart + body.length,
    blank: found.type[index] === 'none' && /^[\s>]*$/.test(line.text),
    leaf: found.type[index]!, leaf_id: found.id[index]!, leaf_first: found.first[index]!,
    attached_here: context.state.attachedLines.has(line.number),
    attribute_line: body.startsWith('{') && isAttributeLine(body, 0, body.length),
    closes_container: context.state.containerClosers.has(line.number),
    get ancestors() { return (ancestors ??= ancestorTypes(line.path, context.nodeTypes as Map<string, string>)) },
    get open_colon() { return (colon ??= openColon(record, context)) },
    get prev() { return model[index - 1] },
    get prev2() { return model[index - 2] },
    get next() { return model[index + 1] },
    get next2() { return model[index + 2] },
  }
  return record
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

function blockRecord(item: Walked, line: ModelLine, start: number, context: LintContext): ModelBlock {
  const { node, path, parent, index } = item
  const types = context.nodeTypes as Map<string, string>
  const quotes = quoteDepth(path, types)
  const column = columnOf(context.source, start, quotes)
  const marker = context.layouts.get(path)?.markerColumn
  const container = (at: string, type: string): Container => {
    const layout = context.layouts.get(at)
    return { type, content_column: ownerContent(type, layout, quotes, context), marker_column: layout?.markerColumn }
  }
  const owner = ownerOf(parent, types)
  return {
    type: blockType(node), path, start, column,
    opener_column: marker !== undefined && node.attrs === undefined ? marker : column,
    attributed: node.attrs !== undefined,
    image_line: node.type === 'paragraph' && node.children.length === 1 && node.children[0]?.type === 'image',
    index,
    after_quote_mark: context.source.slice(line.start, start).endsWith('> '),
    line,
    owner: container(owner.path, owner.type),
    parent: container(parent, types.get(parent) ?? 'document'),
  }
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
