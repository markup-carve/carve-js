/*
 * Markdown import does not write a destination the §25 sink blanks
 * (carve#2254, carve#6010).
 */

import type { Attrs, BlockNode, Document, Image, InlineNode, Paragraph } from '../../ast.js'
import { blankDeniedDestination } from './deny-listed-destination.js'

/** Node types whose `children` hold blocks rather than inline content. */
const BLOCK_HOSTS = new Set(['document', 'block_quote', 'list_item', 'section', 'admonition', 'directive', 'div', 'line_block', 'figure_group'])

export const DENIED_LINK_DESTINATION = 'Dropped a link destination with a denied URL scheme'
export const DENIED_IMAGE_SOURCE = 'Dropped an image source with a denied URL scheme'
export const DENIED_REFERENCE_DESTINATION = 'Dropped a reference definition with a denied URL scheme'

/** Inline formatting with no spelling once empty. */
const WRAPPERS = new Set(['emphasis', 'strong', 'underline', 'strike', 'superscript', 'subscript', 'highlight', 'span', 'insert', 'delete', 'small_caps'])

/** Blocks whose inline content a reader trims at its edges. */
const INLINE_HOSTS = new Set(['paragraph', 'heading', 'table_cell'])

type Node = { type?: string; attrs?: Attrs; [key: string]: unknown }

function isDenied(url: unknown): boolean {
  return typeof url === 'string' && url !== '' && blankDeniedDestination(url) === ''
}

/** Content only, in a span where attributes survive: the HTML importer's shape. */
function standIn(children: InlineNode[], attrs: Attrs | undefined): InlineNode[] {
  return attrs && Object.keys(attrs).length > 0 ? [{ type: 'span', children, attrs }] : children
}

/** The whitespace a dropped edge construct leaves at a block's start or end. */
function trimEdges(nodes: InlineNode[]): InlineNode[] {
  const first = nodes[0]
  if (first?.type === 'text' && !first.attrs) {
    first.value = first.value.replace(/^[ \t]+/, '')
    if (first.value === '') nodes.shift()
  }
  const last = nodes.at(-1)
  if (last?.type === 'text' && !last.attrs) {
    last.value = last.value.replace(/[ \t]+$/, '')
    if (last.value === '') nodes.pop()
  }
  return nodes
}

function altText(image: Image): InlineNode[] {
  return image.alt === '' ? [] : [{ type: 'text', value: image.alt }]
}

/**
 * Replace every link, image and autolink whose destination the renderer's
 * denylist blanks with its content, and remove every reference definition
 * with such a destination. `report` is called once per dropped destination;
 * a reference link is covered by its definition's row.
 */
export function dropDeniedDestinations(document: Document, report: (message: string) => void): boolean {
  let changed = false

  const inlines = (nodes: InlineNode[], edges: boolean): InlineNode[] => {
    const out: InlineNode[] = []
    let dropped = false
    for (const node of nodes) {
      if (node === null || typeof node !== 'object') out.push(node)
      else if (node.type === 'link' && isDenied(node.href)) {
        dropped = changed = true
        if (node.ref === undefined) report(DENIED_LINK_DESTINATION)
        out.push(...standIn(inlines(node.children, false), node.attrs))
      } else if (node.type === 'image' && isDenied(node.src)) {
        dropped = changed = true
        if (node.ref === undefined) report(DENIED_IMAGE_SOURCE)
        out.push(...standIn(altText(node), node.attrs))
      } else if (node.type === 'autolink' && isDenied(node.href)) {
        dropped = changed = true
        report(DENIED_LINK_DESTINATION)
        out.push(...standIn([{ type: 'text', value: node.text ?? node.href }], node.attrs))
      } else {
        const held = WRAPPERS.has(node.type) && ((node as Node).children as unknown[]).length > 0
        visit(node as Node)
        // A wrapper whose only content was a dropped empty link goes with it.
        if (held && ((node as Node).children as unknown[]).length === 0 && !node.attrs) dropped = true
        else out.push(node)
      }
    }
    return dropped && edges ? trimEdges(out) : out
  }

  const blocks = (nodes: BlockNode[]): BlockNode[] => {
    const out: BlockNode[] = []
    for (const node of nodes) {
      if (node.type === 'link_reference_definition' && isDenied(node.href)) {
        changed = true
        report(DENIED_REFERENCE_DESTINATION)
      } else if (node.type === 'image' && isDenied(node.src)) {
        changed = true
        if (node.ref === undefined) report(DENIED_IMAGE_SOURCE)
        const children = altText(node)
        if (children.length > 0 || node.attrs) out.push(paragraph(children, node.attrs))
      } else {
        visit(node as Node)
        out.push(node)
      }
    }
    return out
  }

  const paragraph = (children: InlineNode[], attrs: Attrs | undefined): Paragraph =>
    ({ type: 'paragraph', children, ...(attrs ? { attrs } : {}) })

  const visit = (node: Node): void => {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'pos' || key === 'attrs' || value === null || typeof value !== 'object') continue
      if (key === 'footnoteDefs') {
        const defs = value as Record<string, BlockNode[]>
        for (const label of Object.keys(defs)) defs[label] = blocks(defs[label]!)
      } else if (key === 'definitions' && Array.isArray(value) && value.every(Array.isArray)) {
        node[key] = (value as BlockNode[][]).map(blocks)
      } else if (key === 'target' && node.type === 'figure' && (value as Node).type === 'image' && isDenied((value as Image).src)) {
        const image = value as Image
        changed = true
        if (image.ref === undefined) report(DENIED_IMAGE_SOURCE)
        node[key] = paragraph(standIn(altText(image), image.attrs), undefined)
      } else if (Array.isArray(value)) {
        const block = (key === 'children' && BLOCK_HOSTS.has(node.type ?? '')) || key === 'trailerBlocks' || (key === 'blocks' && node.type === 'table_cell')
        node[key] = block ? blocks(value as BlockNode[]) : inlines(value as InlineNode[], INLINE_HOSTS.has(node.type ?? '') || key === 'caption')
      } else if (typeof (value as Node).type === 'string') {
        visit(value as Node)
      }
    }
  }

  visit(document as unknown as Node)
  return changed
}
