import type { BlockExtensionNode, CodeBlockNode, Inline, InlineExtensionNode, Node, ParagraphNode } from '../../ast.ts'
import type { DocumentTransform } from '../../api.ts'
import type { ExtensionDefinition, ExtensionRenderer, ExtensionRenderHost } from '../types.ts'
import type { ExtensionBundle } from './bundle.ts'
import { bareFallback } from './fenced-render.ts'

const CODE = 'carve.codeCallouts.code'
const LIST = 'carve.codeCallouts.list'
// A `<n>` that ends its line, and a list line that starts with `<n> `.
const MARKER = /<(\d+)>[ \t]*$/
const ITEM = /^<(\d+)> /

const definitions: readonly ExtensionDefinition[] = [
  { name: CODE, version: '1', props: { language: 'string' }, slots: {}, children: 'none' },
  { name: LIST, version: '1', props: {}, slots: { lines: { kind: 'inline' } }, children: 'none' },
]

function lines(children: readonly Inline[]): Inline[][] {
  const result: Inline[][] = [[]]
  for (const child of children) {
    if (child.type === 'soft_break') result.push([])
    else result[result.length - 1]?.push(child)
  }
  return result.filter((line) => line.length > 0)
}

function isList(node: Node | undefined): node is ParagraphNode {
  if (node?.type !== 'paragraph' || node.role !== undefined || node.caption !== undefined) return false
  const split = lines(node.children)
  return split.length > 0 && split.every((line) => line[0]?.type === 'text' && ITEM.test(line[0].value))
}

function codeNode(block: CodeBlockNode): BlockExtensionNode {
  const node: BlockExtensionNode = { type: 'block_extension', name: CODE, version: '1', children: [],
    payload: [{ format: 'text/plain', value: block.value }], fallback: [bareFallback(block)] }
  if (block.syntax !== undefined) node.props = { language: block.syntax }
  if (block.attrs !== undefined) node.attrs = structuredClone(block.attrs)
  if (block.pos !== undefined) node.pos = block.pos
  return node
}

function bareParagraph(paragraph: ParagraphNode): ParagraphNode {
  const copy = structuredClone(paragraph)
  delete copy.attrs
  return copy
}

function listNode(paragraph: ParagraphNode): BlockExtensionNode {
  const node: BlockExtensionNode = { type: 'block_extension', name: LIST, version: '1', children: [],
    slots: { lines: structuredClone(paragraph.children) }, fallback: [bareParagraph(paragraph)] }
  if (paragraph.attrs !== undefined) node.attrs = structuredClone(paragraph.attrs)
  if (paragraph.pos !== undefined) node.pos = paragraph.pos
  return node
}

function bind(nodes: Node[]): void {
  for (let at = 0; at < nodes.length; at++) {
    const node = nodes[at]
    if (node?.type !== 'code_block' || !node.value.split('\n').some((line) => MARKER.test(line))) continue
    nodes[at] = codeNode(node)
    const next = nodes[at + 1]
    if (isList(next)) nodes[++at] = listNode(next)
  }
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}

// A walk over every child list without the core slot table, which would pull the core into this entry.
function visit(value: unknown): void {
  if (Array.isArray(value)) {
    if (value.some(isNode)) bind(value as Node[])
    for (const item of value) visit(item)
    return
  }
  if (typeof value !== 'object' || value === null) return
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'fallback' && key !== 'source' && key !== 'payload' && key !== 'props' && key !== 'pos' && key !== 'attrs') visit(child)
  }
}

/** C2-X-053, C2-X-054: inserts only the two declared callout nodes, each with its core node as fallback. */
const transform: DocumentTransform = {
  name: 'carve.codeCallouts',
  transform(view) {
    visit(view.children)
    const declared = view.extensions ?? []
    for (const definition of definitions) {
      if (declared.some((entry) => entry.name === definition.name)) continue
      declared.push({ name: definition.name, version: definition.version, required: false, slots: Object.keys(definition.slots) })
    }
    if (declared.length > 0) view.extensions = declared
    return view
  },
}

function renderCode(node: BlockExtensionNode | InlineExtensionNode, host: ExtensionRenderHost): string {
  const value = node.payload?.[0]?.value
  const source = typeof value === 'string' ? value : ''
  const language = node.props?.['language']
  const body = source.split('\n').map((line) => {
    const marker = MARKER.exec(line)
    if (marker === null) return host.escapeText(line)
    const before = line.slice(0, marker.index)
    const text = before.trimEnd()
    const n = marker[1] ?? ''
    return `${host.escapeText(text)}${before.slice(text.length)}<b class="callout" data-callout="${n}">${n}</b>`
  }).join('\n')
  const code = typeof language === 'string' ? ` class="language-${host.escapeAttribute(language)}"` : ''
  return `<pre${host.attributes(node, { block: true })}><code${code}>${body}</code></pre>`
}

function renderList(node: BlockExtensionNode | InlineExtensionNode, host: ExtensionRenderHost): string {
  const items = lines((node.slots?.['lines'] ?? []) as Inline[]).map((line) => {
    const [head, ...rest] = line
    if (head?.type !== 'text') return ''
    const n = ITEM.exec(head.value)?.[1] ?? ''
    return `<li value="${n}">${host.inlines([{ ...head, value: head.value.replace(ITEM, '') }, ...rest])}</li>`
  }).join('')
  const attrs = { ...node.attrs, classes: ['callouts', ...(node.attrs?.classes ?? [])] }
  return `<ol${host.attributes({ ...node, attrs } as Node, { block: true })}>${items}</ol>`
}

/** Both channels write the same self-contained HTML (C2-X-052). */
const renderers: Readonly<Record<string, ExtensionRenderer>> = {
  [CODE]: { version: '1', render: renderCode, buildTime: renderCode },
  [LIST]: { version: '1', render: renderList, buildTime: renderList },
}

/** `<n>` markers that end a code line become callout bubbles, and a following `<n> text` paragraph their list. */
export function codeCallouts(): ExtensionBundle {
  return { extensions: definitions, renderers, transforms: [transform] }
}
