// The inline content of a document in the notation of support/inline-shape.ts, read once from the scanner tree of
// support/inline-tree.ts and once from the public `parse`, so a clause test checks the tree builder users get too.
import { expect } from 'vitest'
import { forEachSlot } from '../../src/ast.ts'
import { FLAG_BRACED, INLINE_COMMENT, type Attributes as PublicAttributes, type Node, parse } from '../../src/index.ts'
import { inlineShapeOf } from './inline-shape.ts'
import { type InlineNode, parseTree, type TreeNode } from './inline-tree.ts'

const CONTAINERS = new Map<string, string>([
  ['emphasis', 'em'], ['strong', 'strong'], ['underline', 'u'], ['strike', 's'], ['highlight', 'mark'],
  ['superscript', 'sup'], ['subscript', 'sub'], ['insert', 'ins'], ['delete', 'del'], ['span', 'span'],
  ['inline_footnote', 'fn'], ['line', 'line'],
])

const LEAVES = new Map<string, string>([
  ['non_breaking_space', 'nbsp'], ['hard_break', 'br'], ['soft_break', 'sb'],
])

type Loose = Record<string, unknown> & { type: string, children?: Loose[], attrs?: PublicAttributes }

function quoted(value: unknown): string {
  return `"${(typeof value === 'string' ? value : '').replaceAll('\n', '|')}"`
}

function attributeShape(attributes: PublicAttributes | undefined, lang: unknown): string {
  if (attributes === undefined && lang === undefined) return ''
  const parts: string[] = []
  if (attributes?.id !== undefined) parts.push(`#${attributes.id}`)
  for (const name of attributes?.classes ?? []) parts.push(`.${name}`)
  if (typeof lang === 'string') parts.push(`:${lang}`)
  for (const [key, value] of attributes?.keyValues ?? []) parts.push(`${key}=${/^[^ "]+$/.test(value) ? value : quoted(value)}`)
  return `{${parts.join(' ')}}`
}

function target(node: Loose): string {
  if (typeof node['key'] === 'string') return `${node['refForm'] === 'collapsed' ? '=' : ''}${node['key']}`
  const title = node['tooltip']
  return `${String(node['href'] ?? node['src'] ?? '?')}${title === undefined ? '' : ` ${quoted(title)}`}`
}

function reference(node: Loose): boolean {
  return typeof node['key'] === 'string'
}

const LEAF_SHAPES = new Map<string, (node: Loose) => string>([
  ['text', (node) => quoted(node['value'])],
  ['code', (node) => `code${node['closed'] === false ? '!' : ''}${quoted(node['value'])}`],
  ['literal_inline', (node) => `lit${quoted(node['value'])}`],
  ['math', (node) => `${node['display'] === true ? 'dmath' : 'math'}${quoted(node['value'])}`],
  ['raw_inline', (node) => `raw(${String(node['format'])})${quoted(node['value'])}`],
  ['comment', (node) => `${node['form'] === 'braced' ? '{%}' : '%%'}${quoted(node['value'])}`],
  ['critic_comment', (node) => `{#}${quoted(node['value'])}`],
  ['autolink', (node) => `${String(node['href']).startsWith('mailto:') ? 'mail' : 'auto'}${quoted(node['text'] ?? node['href'])}`],
  ['mention', (node) => `@${quoted(node['target'])}`],
  ['tag', (node) => `#${quoted(node['name'])}`],
  ['symbol', (node) => `sym${quoted(node['name'])}`],
  ['xref', (node) => `xref${quoted(node['key'])}`],
  ['footnote_ref', (node) => `fnref${quoted(node['key'])}`],
  ['smart_punctuation', (node) => `‹${String(node['glyph'])}›`],
  ['image', (node) => `${reference(node) ? 'imgref' : 'img'}(${target(node)})${quoted(node['alt'])}`],
])

function leafShape(node: Loose): string {
  return LEAF_SHAPES.get(node.type)?.(node) ?? LEAVES.get(node.type) ?? `?${node.type}`
}

function inlineShape(node: Loose): string {
  const children = node.children
  let bare: string
  if (node.type === 'link') bare = `${reference(node) ? 'ref' : 'a'}(${target(node)})[${shapes(children ?? [])}]`
  else if (node.type === 'inline_extension') bare = `ext(${String(node['name'])})[${shapes(children ?? [])}]`
  else if (children !== undefined && CONTAINERS.has(node.type)) bare = `${CONTAINERS.get(node.type)!}[${shapes(children)}]`
  else bare = leafShape(node)
  return bare + attributeShape(node.attrs, node['lang'])
}

function shapes(nodes: readonly Loose[]): string {
  return nodes.map(inlineShape).join(' ')
}

const INLINE_HOSTS = new Set(['paragraph', 'heading', 'cell_paragraph', 'definition_term', 'line_block'])

function publicRuns(node: Node, out: string[]): void {
  if (INLINE_HOSTS.has(node.type)) {
    out.push(shapes(flattened((node as unknown as Loose).children ?? [])))
    const caption = (node as unknown as Loose)['caption']
    if (caption !== undefined) publicRuns(caption as Node, out)
    return
  }
  forEachSlot(node, (nodes) => { for (const child of nodes) publicRuns(child, out) })
}

/** The scanner sees no definitions: an abbreviation is its text, and a shortcut reference its brackets and text. */
function flattened(nodes: readonly Loose[]): Loose[] {
  const out: Loose[] = []
  for (const node of nodes) flatten(node, out)
  return out
}

function appendText(out: Loose[], value: string): void {
  const last = out.at(-1)
  if (last?.type === 'text' && last.attrs === undefined) out[out.length - 1] = { type: 'text', value: `${String(last['value'])}${value}` }
  else out.push({ type: 'text', value })
}

function flatten(node: Loose, out: Loose[]): void {
  if (node.type === 'abbreviation') appendText(out, String(node['key']))
  else if (node.type === 'text') appendText(out, String(node['value']))
  else if (node.type === 'link' && node['refForm'] === 'shortcut') {
    appendText(out, '[')
    for (const child of node.children ?? []) flatten(child, out)
    appendText(out, ']')
  } else out.push(node.children === undefined ? node : { ...node, children: flattened(node.children) })
}

/** The scanner keeps what C2-A-074 trims from a comment, and an empty brace block as attributes. */
function normalized(node: InlineNode): InlineNode {
  const attributes = node.attributes
  const empty = attributes !== null && attributes.id === null && attributes.classes.length === 0 && attributes.lang === null
    && attributes.keyValues.length === 0
  let value = node.value
  if (node.kind === INLINE_COMMENT && value !== null) {
    value = (node.flags & FLAG_BRACED) !== 0 ? value.replace(/^ /, '').replace(/ $/, '') : value.replace(/^ /, '').replace(/[ \t]+$/, '')
  }
  return { ...node, value, attributes: empty ? null : attributes, children: node.children?.map(normalized) ?? null }
}

function scannerRuns(src: string, node: TreeNode, out: string[]): void {
  if (node.inlines !== null && node.inlines !== undefined) out.push(inlineShapeOf(src, node.inlines.map(normalized)))
  for (const child of node.children ?? []) scannerRuns(src, child as TreeNode, out)
}

/** The inline runs of `src` as the public parse gives them, sorted. */
export function publicInlineRuns(src: string): string[] {
  const out: string[] = []
  publicRuns(parse(src, { positions: false }) as unknown as Node, out)
  return out.sort()
}

/** The inline runs of `src` as the scanner tree gives them, sorted. */
export function scannerInlineRuns(src: string): string[] {
  const out: string[] = []
  scannerRuns(src, parseTree(src), out)
  return out.sort()
}

/** Fails when the public tree and the scanner tree of `src` disagree on any inline run. */
export function expectPublicInlines(src: string): void {
  expect(publicInlineRuns(src), src).toEqual(scannerInlineRuns(src))
}
