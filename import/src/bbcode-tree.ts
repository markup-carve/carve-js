// The Carve tree of BBCode items, built without the HTML route. It gives the tree the HTML importer reads from the
// HTML that `bbcode.ts` writes for the same items, finding for finding; `needsHtmlRoute` names what only parse5 reads.
import type { Block, Inline, ListItemNode, TableCellNode, TableNode, TableRowNode } from '../../src/index.ts'
import { readAttribution } from './bbcode-quote.ts'
import {
  BLOCK, codeLanguage, codeValue, INLINE, isTag, itemHasBlocks, PARAGRAPH_BREAK, plainText, type Item, type Tag,
} from './bbcode-items.ts'
import { flattenCellBreaks } from './html.ts'
import { collapseBreaks, trimEdges } from './html-inline.ts'
import { resolveAlignments } from './html-table-align.ts'
import {
  classNames, coalesce, commentEmptyItems, complete, finding, imageParagraph, paragraph, safeUrl, softText, withDestination, type Context,
  type ImportResult,
} from './kit.ts'

/** Below this nesting the HTML of the items stays well inside the depth limit parse5 trees are checked against. */
const MAX_DIRECT_DEPTH = 64

const LINKS = new Set(['url', 'email', 'youtube'])

/**
 * The inputs whose HTML parse5 changes on the way: it drops a NUL in text and replaces it in an attribute, it splits
 * a link inside a link (the adoption agency), and a deep nesting is refused by its depth check.
 */
export function needsHtmlRoute(input: string, items: Item[]): boolean {
  return input.includes('\0') || reshaped(items, 0, false)
}

function reshaped(items: Item[], depth: number, inLink: boolean): boolean {
  for (const item of items) {
    if (typeof item === 'string') continue
    if (depth >= MAX_DIRECT_DEPTH || (inLink && LINKS.has(item.name))) return true
    if (reshaped(item.children, depth + 1, inLink || item.name === 'url' || item.name === 'email')) return true
  }
  return false
}

type FormatType = 'strong' | 'emphasis' | 'underline' | 'delete' | 'superscript' | 'subscript'

/** The inline HTML of the items as parse5 reads it: elements, and text merged across the tags that write none. */
type Node = string
  | { el: 'format', type: FormatType, children: Node[] }
  | { el: 'code', value: string }
  | { el: 'a', href: string, children: Node[] }
  | { el: 'img', src: string, alt: string }

const FORMATS: Record<string, FormatType> = { strong: 'strong', em: 'emphasis', u: 'underline', del: 'delete', sup: 'superscript',
  sub: 'subscript' }

function pushText(out: Node[], value: string): void {
  if (value === '') return
  const last = out.length - 1
  if (typeof out[last] === 'string') out[last] += value
  else out.push(value)
}

function nodesOf(items: Item[], out: Node[] = []): Node[] {
  for (const item of items) {
    if (typeof item === 'string') pushText(out, item)
    else tagNodes(item, out)
  }
  return out
}

function tagNodes(tag: Tag, out: Node[]): void {
  const element = INLINE[tag.name]
  if (element !== undefined) {
    out.push({ el: 'format', type: FORMATS[element]!, children: nodesOf(tag.children) })
    return
  }
  switch (tag.name) {
    case 'c':
    case 'icode': out.push({ el: 'code', value: plainText(tag.children) }); return
    case 'noparse': pushText(out, plainText(tag.children)); return
    case 'url': {
      const href = (tag.value ?? plainText(tag.children)).trim()
      out.push({ el: 'a', href, children: tag.value === undefined ? nodesOf([href]) : nodesOf(tag.children) })
      return
    }
    case 'email': {
      const address = (tag.value ?? plainText(tag.children)).trim()
      out.push({ el: 'a', href: `mailto:${address}`, children: tag.value === undefined ? nodesOf([address]) : nodesOf(tag.children) })
      return
    }
    case 'img': out.push({ el: 'img', src: plainText(tag.children).trim(), alt: tag.value ?? '' }); return
    case 'youtube': {
      const url = `https://www.youtube.com/watch?v=${encodeURIComponent(plainText(tag.children).trim())}`
      out.push({ el: 'a', href: url, children: [url] })
      return
    }
    default: nodesOf(tag.children, out)
  }
}

/** The HTML of a paragraph, list item or cell is trimmed as a string, so only its outer text loses whitespace. */
function trimmed(nodes: Node[]): Node[] {
  const first = nodes[0]
  if (typeof first === 'string') {
    if (first.trimStart() === '') nodes.shift()
    else nodes[0] = first.trimStart()
  }
  const last = nodes.at(-1)
  if (typeof last === 'string') {
    if (last.trimEnd() === '') nodes.pop()
    else nodes[nodes.length - 1] = last.trimEnd()
  }
  return nodes
}

const NEEDS_CONTENT = new Set(['strong', 'emphasis', 'delete', 'underline', 'subscript', 'superscript', 'link'])

function isEmpty(node: Inline): boolean {
  return NEEDS_CONTENT.has(node.type) && 'children' in node && node.children.length === 0
}

/** Appends `node`, merging adjacent text as `coalesce` does. */
function push(out: Inline[], node: Inline): void {
  const last = out[out.length - 1]
  if (node.type === 'text' && last?.type === 'text') last.value += node.value
  else out.push(node)
}

function inlineChildren(nodes: Node[], context: Context): Inline[] {
  const out: Inline[] = []
  for (const node of nodes) inline(node, context, out)
  return collapseBreaks(out)[0]
}

function inline(node: Node, context: Context, out: Inline[]): void {
  if (typeof node === 'string') {
    for (const part of softText(node)) push(out, part)
    return
  }
  switch (node.el) {
    case 'format': {
      const children = inlineChildren(node.children, context)
      if (children.length > 0) out.push({ type: node.type, children })
      return
    }
    case 'code': out.push({ type: 'code', value: node.value }); return
    case 'img': for (const part of image(node, context)) push(out, part); return
    case 'a': {
      const children = inlineChildren(node.children, context)
      const href = safeUrl(context, 'a', node.href)
      for (const part of withDestination({ type: 'link', children, ...(href !== undefined ? { href } : {}) })) {
        if (!isEmpty(part)) push(out, part)
      }
    }
  }
}

function image(node: Extract<Node, { el: 'img' }>, context: Context): Inline[] {
  const src = safeUrl(context, 'img', node.src)
  return withDestination({ type: 'image', ...(src !== undefined ? { src } : {}), alt: node.alt })
}

function edgeInline(nodes: Node[], context: Context): Inline[] {
  return trimEdges(inlineChildren(nodes, context))
}

/** A `<p>`: dropped when empty, and a paragraph of one image has the role `image` (C2-H-020). */
function paragraphOf(nodes: Node[], context: Context): Block[] {
  const children = edgeInline(nodes, context)
  if (children.length === 0) return []
  const only = children.length === 1 ? children[0] : undefined
  return [only?.type === 'image' ? { type: 'paragraph', role: 'image', children } : paragraph(children)]
}

/** Inline content where blocks stand: one paragraph, or one image paragraph per image when it holds only images. */
function flowOf(nodes: Node[], context: Context): Block[] {
  const solid = nodes.filter(node => typeof node !== 'string' || node.trim() !== '')
  if (solid.length === 0) return []
  if (solid.every(node => typeof node !== 'string' && node.el === 'img')) {
    return solid.flatMap(node => imageParagraph(image(node as Extract<Node, { el: 'img' }>, context)))
  }
  const children = edgeInline(nodes, context)
  return children.length > 0 ? [paragraph(children)] : []
}

/** The blocks of a container, and whether its first element is a `<p>`, which makes a list loose (C2-H-034). */
interface Blocks { blocks: Block[], lead?: 'p' | 'other' }

function blocksOf(items: Item[], context: Context, out: Blocks = { blocks: [] }): Blocks {
  let run: Item[] = []
  const flush = (): void => {
    const paragraphs: Item[][] = [[]]
    for (const item of run) {
      if (typeof item !== 'string') { paragraphs.at(-1)?.push(item); continue }
      item.split(PARAGRAPH_BREAK).forEach((part, index) => {
        if (index > 0) paragraphs.push([])
        paragraphs.at(-1)?.push(part)
      })
    }
    for (const items of paragraphs) {
      const nodes = trimmed(nodesOf(items))
      if (nodes.length === 0) continue
      out.lead ??= 'p'
      out.blocks.push(...paragraphOf(nodes, context))
    }
    run = []
  }
  for (const item of items) {
    if (typeof item === 'string' || !BLOCK.has(item.name)) { run.push(item); continue }
    flush()
    blockTag(item, context, out)
  }
  flush()
  return out
}

function emit(out: Blocks, block: Block): void {
  out.lead ??= 'other'
  out.blocks.push(block)
}

function blockTag(tag: Tag, context: Context, out: Blocks): void {
  switch (tag.name) {
    case 'hr': emit(out, { type: 'thematic_break' }); return
    case 'code': emit(out, codeBlock(tag, context)); return
    case 'quote': {
      const quote: Block = { type: 'block_quote', children: blocksOf(tag.children, context).blocks }
      const caption = tag.value === undefined ? '' : readAttribution(tag.value).caption
      emit(out, caption ? { ...quote, caption: { type: 'caption', children: flowOf([caption], context) } } : quote)
      return
    }
    case 'spoiler': emit(out, { type: 'div', children: blocksOf(tag.children, context).blocks, attrs: { classes: ['spoiler'] } }); return
    case 'center':
    case 'left':
    case 'right':
      emit(out, { type: 'div', children: blocksOf(tag.children, context).blocks, attrs: { keyValues: [['align', tag.name]] } })
      return
    case 'list': list(tag, context, out); return
    case 'table': table(tag, context, out); return
    default: blocksOf(tag.children, context, out)
  }
}

function codeBlock(tag: Tag, context: Context): Block {
  const value = codeValue(tag)
  const language = codeLanguage(tag)
  const classes = language ? classNames(`language-${language}`) : []
  const syntax = classes.find(name => name.startsWith('language-'))?.slice(9)
  if (classes.some(name => !name.startsWith('language-'))) {
    finding(context, 'import-attribute-dropped', 'code', 'Code element attributes other than language dropped')
  }
  return { type: 'code_block', value: value && !value.endsWith('\n') ? `${value}\n` : value, ...(syntax ? { syntax } : {}) }
}

/** C2-M-033: a list of one item is tight; C2-H-034: an item that opens with a `<p>` makes the list loose. */
function list(tag: Tag, context: Context, out: Blocks): void {
  blocksOf(tag.children.filter(item => !isTag(item, '*')), context, out)
  const tags = tag.children.filter(item => isTag(item, '*'))
  if (tags.length === 0) return
  let loose = false
  const items: ListItemNode[] = tags.map(item => {
    if (!itemHasBlocks(item.children)) return { type: 'list_item', children: flowOf(trimmed(nodesOf(item.children)), context) }
    const inner = blocksOf(item.children, context)
    if (inner.lead === 'p') loose = true
    return { type: 'list_item', children: inner.blocks }
  })
  const value = tag.value ?? ''
  const marker = value === '' ? { kind: 'bullet' as const, char: '-' }
    : { kind: 'ordered' as const, style: /^[aAiI]$/u.test(value) ? value : '1', delimiter: '.' }
  const spacing = items.length <= 1 ? 'tight' : loose || items.some(item => item.children.filter(child => child.type !== 'list').length > 1)
    ? 'loose' : 'tight'
  emit(out, { type: 'list', children: items, marker, spacing })
}

function cell(tag: Tag, context: Context): TableCellNode {
  const children = edgeInline(trimmed(nodesOf(tag.children)), context)
  flattenCellBreaks(children)
  return { type: 'table_cell', header: tag.name === 'th', children: [{ type: 'cell_paragraph', children: coalesce(children) }] }
}

function row(cells: Tag[], context: Context): TableRowNode {
  return { type: 'table_row', children: cells.map(entry => cell(entry, context)) }
}

/** Rows of `[tr]` with `[td]` and `[th]` cells; a first row of header cells only is the head, read after the body. */
function table(tag: Tag, context: Context, out: Blocks): void {
  const rowTags = tag.children.filter(item => isTag(item, 'tr'))
  blocksOf(tag.children.filter(item => !isTag(item, 'tr')), context, out)
  for (const rowTag of rowTags) blocksOf(rowTag.children.filter(item => !isTag(item, 'td', 'th')), context, out)
  const rows = rowTags.map(rowTag => rowTag.children.filter((item): item is Tag => isTag(item, 'td', 'th')))
  if (!rows.some(cells => cells.length > 0)) return
  const first = rows[0]
  const head = first !== undefined && first.length > 0 && first.every(entry => entry.name === 'th')
  const bodyRows = head ? rows.slice(1) : rows
  const children: TableNode['children'] = bodyRows.length > 0
    ? [{ type: 'table_body', children: bodyRows.map(cells => row(cells, context)) }] : []
  if (head && first) children.unshift({ type: 'table_head', children: [row(first, context)] })
  const width = Math.max(0, ...rows.map(cells => cells.length))
  const result: TableNode = { type: 'table', children, columns: Array.from({ length: width }, () => ({ type: 'table_column' as const })) }
  resolveAlignments(result)
  emit(out, result)
}

/** The import of BBCode items that `needsHtmlRoute` lets through. */
export function importBbcodeItems(items: Item[]): ImportResult {
  // The HTML importer reads these trees, so the source format and the finding codes stay those of HTML.
  const context: Context = { format: 'html', input: '', diagnostics: [] }
  return complete(context, commentEmptyItems(blocksOf(items, context).blocks))
}
