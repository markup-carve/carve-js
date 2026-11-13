// A one-line picture of inline nodes, for tests. Nodes are separated by spaces.
//   "text"  em[...] strong[...] u[...] s[...] mark[...] sup[...] sub[...] ins[...] del[...]
//   span[...]  a(/u)[...]  a(/u "T")[...]  ref(key)[...]  ref(=key)[...] for the collapsed form
//   img(/u)"alt"  imgref(key)"alt"  fn[...]  ext(name)[...]
//   code"x"  lit"x"  math"x"  dmath"x"  raw(html)"x"  code!"x" for a span with no closing run
//   %%"c" line comment  {%}"c" braced comment  {#}"c" editorial comment
//   auto"url"  mail"a@b.c"  xref"id"  @"user"  #"tag"  sym"name"  fnref"key"
//   nbsp  br (hard break)  sb (soft break)  ‹“› for a smart punctuation node, by its glyph
//   A host with attributes has them behind it in the fixed order: span["s"]{#a .b :en k=v open=""}
import {
  type Attributes, AUTOLINK, CODE_SPAN, EDITORIAL, FIRST_INLINE_KIND, FLAG_BRACED, FLAG_COLLAPSED, FLAG_DISPLAY,
  FLAG_EMAIL, FLAG_OPEN_END, FLAG_REFERENCE, FOOTNOTE_REF, foldLabel, HARD_BREAK, IMAGE, INLINE_COMMENT,
  INLINE_EXTENSION, INLINE_FOOTNOTE, LINK, LITERAL, MATH, MENTION, NBSP, RAW_INLINE, SMART, SMART_GLYPHS, SOFT_BREAK,
  SYMBOL, TAG, XREF,
} from '../../src/index.ts'
import { type InlineNode, LINE, TEXT } from './inline-tree.ts'

const CONTAINER_NAMES = ['em', 'strong', 'u', 's', 'mark', 'sup', 'sub', 'ins', 'del', 'span']

const LEAF_NAMES = new Map<number, string>([
  [CODE_SPAN, 'code'], [LITERAL, 'lit'], [EDITORIAL, '{#}'], [XREF, 'xref'], [MENTION, '@'], [TAG, '#'],
  [SYMBOL, 'sym'], [NBSP, 'nbsp'], [HARD_BREAK, 'br'], [SOFT_BREAK, 'sb'],
])

function quoted(value: string | null): string {
  return `"${(value ?? '').replaceAll('\n', '|')}"`
}

function attributeShape(attributes: Attributes | null): string {
  if (attributes === null) return ''
  const parts: string[] = []
  if (attributes.id !== null) parts.push(`#${attributes.id}`)
  for (const name of attributes.classes) parts.push(`.${name}`)
  if (attributes.language !== null) parts.push(`:${attributes.language}`)
  for (const [key, value] of attributes.keys) parts.push(`${key}=${/^[^ "]+$/.test(value) ? value : quoted(value)}`)
  return `{${parts.join(' ')}}`
}

function target(node: InlineNode): string {
  if ((node.flags & FLAG_REFERENCE) !== 0) return `${(node.flags & FLAG_COLLAPSED) !== 0 ? '=' : ''}${node.label ?? '?'}`
  return `${node.destination ?? '?'}${node.title === null ? '' : ` ${quoted(node.title)}`}`
}

function leafName(node: InlineNode): string {
  const open = (node.flags & FLAG_OPEN_END) !== 0 ? '!' : ''
  switch (node.kind) {
    case MATH: return `${(node.flags & FLAG_DISPLAY) !== 0 ? 'dmath' : 'math'}${open}`
    case CODE_SPAN: case LITERAL: return `${LEAF_NAMES.get(node.kind)!}${open}`
    case AUTOLINK: return (node.flags & FLAG_EMAIL) !== 0 ? 'mail' : 'auto'
    case INLINE_COMMENT: return (node.flags & FLAG_BRACED) !== 0 ? '{%}' : '%%'
    default: return LEAF_NAMES.get(node.kind) ?? `?${node.kind}`
  }
}

function containerShape(src: string, node: InlineNode): string {
  const children = inlineShapeOf(src, node.children!)
  const reference = (node.flags & FLAG_REFERENCE) !== 0
  switch (node.kind) {
    case LINK: return `${reference ? 'ref' : 'a'}(${target(node)})[${children}]`
    case INLINE_FOOTNOTE: return `fn[${children}]`
    case INLINE_EXTENSION: return `ext(${src.slice(node.start + 1, node.aux)})[${children}]`
    case LINE: return `line[${children}]`
    default: return `${CONTAINER_NAMES[node.kind - FIRST_INLINE_KIND]!}[${children}]`
  }
}

function bare(src: string, node: InlineNode): string {
  if (node.children !== null) return containerShape(src, node)
  switch (node.kind) {
    case TEXT: return quoted(node.value)
    case SMART: return `‹${SMART_GLYPHS[node.aux]!}›`
    case NBSP: case HARD_BREAK: case SOFT_BREAK: return LEAF_NAMES.get(node.kind)!
    case IMAGE: return `${(node.flags & FLAG_REFERENCE) !== 0 ? 'imgref' : 'img'}(${target(node)})${quoted(node.value)}`
    case RAW_INLINE: return `raw(${src.slice(node.aux, src.indexOf('}', node.aux))})${quoted(node.value)}`
    case FOOTNOTE_REF: return `fnref${quoted(foldLabel(node.value ?? ''))}`
    default: return `${leafName(node)}${quoted(node.value)}`
  }
}

export function inlineShapeOf(src: string, nodes: InlineNode[]): string {
  return nodes.map((node) => bare(src, node) + attributeShape(node.attributes)).join(' ')
}
