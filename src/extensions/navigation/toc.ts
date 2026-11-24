import { type Attrs, type Block, type BlockExtensionNode, type DirectiveNode, type DocumentNode, type HeadingNode, type Inline,
  type ListItemNode, type ListNode, type Node } from '../../ast.ts'
import { type ExtensionDefinition, type ExtensionRenderer, type ExtensionRenderHost } from '../types.ts'
import { declare, derivedInlines, headingId, indentHtml, rewriteTree, visitTree } from './common.ts'

/** Options of {@link tableOfContents}. */
export interface TableOfContentsOptions {
  /** Lowest heading level listed (1-6). Default 1. */
  minLevel?: number
  /** Highest heading level listed (1-6). Default 6. */
  maxLevel?: number
  /** List element of the entries. Default `'ul'`. */
  listType?: 'ul' | 'ol'
  /** Class of the `<nav>`. Default `'toc'`. */
  cssClass?: string
  /** Where the table goes. Default `'top'`. */
  position?: 'top' | 'bottom'
  /** Writes a `<details>` disclosure instead of the `<nav>`. Default false. */
  collapsible?: boolean
  /** Summary of the disclosure. Default `'Table of Contents'`. */
  summary?: string
  /** Opens the disclosure. Default false. */
  open?: boolean
}

interface Entry {
  level: number
  id: string
  text: Inline[]
}

function entry(heading: HeadingNode): Entry | null {
  const id = headingId(heading)
  return id === undefined ? null : { level: heading.level, id, text: derivedInlines(heading.children) }
}

function emptyList(ordered: boolean): ListNode {
  return { type: 'list', marker: ordered ? { kind: 'ordered', style: '1', delimiter: '.' } : { kind: 'bullet', char: '-' },
    spacing: 'tight', children: [] }
}

/** A deeper entry nests under the item before it; a shallower one closes the lists deeper than it. */
function entryList(entries: readonly Entry[], ordered: boolean): ListNode | null {
  const first = entries[0]
  if (first === undefined) return null
  const root = emptyList(ordered)
  const stack = [{ level: first.level, list: root }]
  for (const item of entries) {
    let top = stack[stack.length - 1]!
    const last = top.list.children[top.list.children.length - 1]
    if (last !== undefined && item.level > top.level) {
      const nested = emptyList(ordered)
      last.children.push(nested)
      top = { level: item.level, list: nested }
      stack.push(top)
    } else if (last !== undefined) {
      while (stack.length > 1 && item.level <= stack[stack.length - 2]!.level) stack.pop()
      top = stack[stack.length - 1]!
      top.level = item.level
    }
    const link: Inline = { type: 'link', href: `#${item.id}`, children: item.text }
    const listItem: ListItemNode = { type: 'list_item', children: [{ type: 'paragraph', children: [link] }] }
    top.list.children.push(listItem)
  }
  return root
}

function clampLevel(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.min(6, Math.max(1, Math.trunc(value)))
}

const TOC = 'carve.toc'

/**
 * A table of contents of the top-level headings, inserted at the top or bottom of the render view (C2-X-053). Its
 * fallback is the list of links; `tocRenderer` writes it inside a named `<nav>`.
 */
export function tableOfContents(options: TableOfContentsOptions = {}): ExtensionDefinition {
  const minLevel = clampLevel(options.minLevel, 1)
  const maxLevel = clampLevel(options.maxLevel, 6)
  const ordered = options.listType === 'ol'
  const props: Record<string, unknown> = {}
  if (options.collapsible === true) {
    props['collapsible'] = true
    props['summary'] = options.summary ?? 'Table of Contents'
    if (options.open === true) props['open'] = true
  }
  return {
    name: TOC, version: '1', props: { collapsible: 'boolean', summary: 'string', open: 'boolean' },
    slots: { list: { kind: 'block' } }, children: 'none',
    documentTransform(view: DocumentNode): DocumentNode {
      const entries: Entry[] = []
      for (const node of view.children) {
        if (node.type !== 'heading' || node.level < minLevel || node.level > maxLevel) continue
        const found = entry(node)
        if (found !== null) entries.push(found)
      }
      const list = entryList(entries, ordered)
      if (list === null) return view
      declare(view, TOC, ['list'])
      const toc: BlockExtensionNode = { type: 'block_extension', name: TOC, version: '1', children: [],
        attrs: { classes: [options.cssClass ?? 'toc'] }, slots: { list: [list] }, fallback: [structuredClone(list)] }
      if (Object.keys(props).length > 0) toc.props = { ...props }
      if (options.position === 'bottom') view.children.push(toc)
      else view.children.unshift(toc)
      return view
    },
  }
}

const PLACEMENT = 'carve.tocPlacement'
const WINDOW_KEYS = new Set(['depth', 'from', 'to'])

function windowOf(attrs: Attrs | undefined): { minLevel: number, maxLevel: number } {
  const value = (name: string): number | undefined => {
    const pair = attrs?.keyValues?.find(([key]) => key === name)
    return pair === undefined ? undefined : Number.parseInt(pair[1], 10)
  }
  const from = value('from')
  const to = value('to')
  if (from !== undefined || to !== undefined) {
    const low = clampLevel(from, 1)
    const high = clampLevel(to, 6)
    return low <= high ? { minLevel: low, maxLevel: high } : { minLevel: high, maxLevel: low }
  }
  return { minLevel: 1, maxLevel: clampLevel(value('depth'), 6) }
}

function placementAttrs(attrs: Attrs | undefined): Attrs {
  const result: Attrs = { classes: ['toc', ...(attrs?.classes ?? []).filter((name) => name !== 'toc')] }
  if (attrs?.id !== undefined) result.id = attrs.id
  const pairs = (attrs?.keyValues ?? []).filter(([key]) => !WINDOW_KEYS.has(key))
  if (pairs.length > 0) result.keyValues = pairs
  return result
}

function placement(directive: DirectiveNode, entries: readonly Entry[]): BlockExtensionNode {
  const { minLevel, maxLevel } = windowOf(directive.attrs)
  const list = entryList(entries.filter((item) => item.level >= minLevel && item.level <= maxLevel), false)
  const body: Block[] = directive.children
  const fallback: Block[] = []
  if (directive.title !== undefined) {
    fallback.push({ type: 'paragraph', children: [{ type: 'strong', children: structuredClone(directive.title) }] })
  }
  fallback.push(...structuredClone(body))
  if (list !== null) fallback.push(structuredClone(list))
  const slots: Record<string, Node[]> = { body, list: list === null ? [] : [list] }
  if (directive.title !== undefined) slots['title'] = directive.title
  const node: BlockExtensionNode = { type: 'block_extension', name: PLACEMENT, version: '1', children: [],
    attrs: placementAttrs(directive.attrs), slots, fallback }
  if (directive.groupLabel !== undefined) node.props = { label: directive.groupLabel }
  if (directive.pos !== undefined) node.pos = directive.pos
  return node
}

/**
 * Writes a table of contents at each `toc` directive: the directive is claimed (C2-X-053) and its headings window comes
 * from `{depth=N}` or `{from=X to=Y}`. Without this extension the directive stays the core `<div class="toc">`.
 */
export function tocPlacement(): ExtensionDefinition {
  return {
    name: PLACEMENT, version: '1', props: { label: 'string' }, children: 'none',
    slots: { title: { kind: 'inline', optional: true }, body: { kind: 'block' }, list: { kind: 'block' } },
    documentTransform(view: DocumentNode): DocumentNode {
      const entries: Entry[] = []
      let directives = 0
      visitTree(view, (node, ancestors) => {
        if (node.type === 'directive' && node.kind === 'toc') directives++
        // carve#6531: the placed table lists the top-level headings, as tableOfContents does.
        if (node.type !== 'heading' || ancestors.length > 1) return
        const found = entry(node)
        if (found !== null) entries.push(found)
      }, false)
      if (directives === 0) return view
      declare(view, PLACEMENT, ['title', 'body', 'list'])
      rewriteTree(view, (node) => node.type === 'directive' && node.kind === 'toc' ? [placement(node, entries)] : undefined,
        false)
      return view
    },
  }
}

function navName(host: ExtensionRenderHost, node: Node): string {
  const authored = node.attrs?.keyValues?.some(([key]) => ['aria-label', 'aria-labelledby'].includes(key.toLowerCase()))
  const label = host.labels['tocNav'] ?? 'Table of contents'
  return authored === true || label === '' ? '' : ` aria-label="${host.escapeAttribute(label)}"`
}

function renderToc(node: BlockExtensionNode | { type: 'inline_extension' }, host: ExtensionRenderHost): string {
  if (node.type !== 'block_extension') return ''
  const list = indentHtml(host.blocks(node.slots?.['list'] ?? []), host.blockDepth + 1)
  const close = '  '.repeat(host.blockDepth)
  if (node.props?.['collapsible'] === true) {
    const summary = typeof node.props['summary'] === 'string' ? node.props['summary'] : 'Table of Contents'
    const head = indentHtml(`<summary>${host.escapeText(summary)}</summary>`, host.blockDepth + 1)
    return `<details${host.attributes(node, { block: true })}${node.props['open'] === true ? ' open' : ''}>\n` +
      `${head}\n${list}\n${close}</details>`
  }
  return `<nav${host.attributes(node, { block: true })}${navName(host, node)}>\n${list}\n${close}</nav>`
}

/** The title and label lines of a placed table, and the attribute that names its nav. */
function placementHead(node: BlockExtensionNode, host: ExtensionRenderHost): { head: string, name: string } {
  const title = node.slots?.['title'] ?? []
  const label = node.props?.['label']
  let head = ''
  let name = navName(host, node)
  if (title.length > 0) {
    const id = name === '' ? '' : host.nextId('toc-title')
    if (id !== '') name = ` aria-labelledby="${host.escapeAttribute(id)}"`
    head += `<p class="admonition-title"${id === '' ? '' : ` id="${host.escapeAttribute(id)}"`}>${host.inlines(title)}</p>\n`
  }
  if (typeof label === 'string' && label !== '') head += `<p class="div-label">${host.escapeText(label)}</p>\n`
  return { head, name }
}

function renderPlacement(node: BlockExtensionNode | { type: 'inline_extension' }, host: ExtensionRenderHost): string {
  if (node.type !== 'block_extension') return ''
  const body = node.slots?.['body'] ?? []
  const list = node.slots?.['list'] ?? []
  const { head, name } = placementHead(node, host)
  const inner = head + (list.length === 0 ? '' : host.blocks(list))
  const close = '  '.repeat(host.blockDepth)
  const nav = `<nav${host.attributes(node, { block: true })}${name}>` +
    (inner === '' ? '' : `\n${indentHtml(inner.replace(/\n$/u, ''), host.blockDepth + 1)}\n${close}`) + '</nav>'
  return body.length === 0 ? nav : `${indentHtml(host.blocks(body), host.blockDepth).trimStart()}\n${close}${nav}`
}

/** The renderers of `carve.toc` and `carve.tocPlacement`, for both modes (C2-X-052): the output holds no script. */
export const tocRenderers: Readonly<Record<string, ExtensionRenderer>> = {
  [TOC]: { version: '1', render: renderToc, buildTime: renderToc },
  [PLACEMENT]: { version: '1', render: renderPlacement, buildTime: renderPlacement },
}
