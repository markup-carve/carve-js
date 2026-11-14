// The public tree of contract 2.0 (spec/0.2/ast.md). `Node` (ast-nodes.ts) has one interface per
// node type, told apart by `type`.
import { type Block, type CaptionNode, type DocumentNode, type Inline, type Node } from './ast-nodes.ts'

export type * from './ast-nodes.ts'
export { FIELD_VALUES, handle, isFieldValue } from './ast-nodes.ts'

export const AST_VERSION = '2.0'

/** C2-A-140, C2-A-141: lines and columns from 1, columns in code points, offsets in UTF-8 bytes, ends exclusive. */
export interface Position {
  startLine: number
  endLine: number
  startColumn: number
  endColumn: number
  startOffset: number
  endOffset: number
  file?: string
}

/** C2-A-032: the id, the classes and the pairs of keys, each in written order. */
export interface Attrs {
  id?: string
  classes?: string[]
  keyValues?: [string, string][]
}

/** C2-A-054, C2-A-056. */
export interface Marker {
  kind: 'bullet' | 'ordered'
  char?: string
  style?: string
  delimiter?: string
  start?: number
}

/** C2-A-060, C2-A-061. */
export interface Task {
  mark: string
  status: string
}

export interface RubyPair {
  type: 'rubyPair'
  base: Inline[]
  annotation: Inline[]
}

export interface ExtensionDeclaration {
  name: string
  required: boolean
  version?: string
}

export interface Resource {
  id: string
  mediaType: string
  digest: string
  href?: string
  size?: number
}

/** C2-A-012: the envelope a tree travels in at a storage or process boundary. */
export interface Envelope {
  astVersion: string
  document: DocumentNode
  vocabulary?: string
  extensions?: ExtensionDeclaration[]
}

export const DEFINITION_TYPES: readonly string[] = ['footnote', 'link_reference_definition', 'abbreviation_def', 'citation_definition']

/** A node whose children are inline nodes. */
export type InlineParent = Extract<Node, { children: Inline[] }>

/** The node types with inline content in `children`: those of `InlineParent`. */
export const INLINE_PARENTS: readonly InlineParent['type'][] = [
  'paragraph', 'heading', 'definition_term', 'cell_paragraph', 'line', 'citation_definition', 'emphasis', 'strong',
  'underline', 'strike', 'highlight', 'superscript', 'subscript', 'insert', 'delete', 'span', 'link', 'inline_footnote',
  'inline_extension', 'small_caps',
]

const INLINE_PARENT_TYPES: ReadonlySet<string> = new Set(INLINE_PARENTS)

/** A node whose children are blocks. */
export type BlockParent = Extract<Node, { children: Block[] }>

const BLOCK_PARENTS: readonly BlockParent['type'][] = [
  'admonition', 'block_extension', 'block_quote', 'caption', 'definition_description', 'directive', 'div', 'figure',
  'figure_group', 'footnote', 'list_item', 'section',
]

const BLOCK_PARENT_TYPES: ReadonlySet<string> = new Set(BLOCK_PARENTS)

/** The inline title of `node`, where it has one (C2-A-024). The title of a link definition is a string and no slot. */
export function titleOf(node: Node): Inline[] | undefined {
  return 'title' in node && Array.isArray(node.title) ? node.title : undefined
}

/** The caption of `node`, where it has one (C2-A-024). */
export function captionOf(node: Node): CaptionNode | undefined {
  return 'caption' in node ? node.caption : undefined
}

/** Whether the children of `node` are inline nodes. */
export function isInlineParent(node: Node): node is InlineParent {
  return INLINE_PARENT_TYPES.has(node.type)
}

/** Whether the children of `node` are blocks. */
export function isBlockParent(node: Node): node is BlockParent {
  return BLOCK_PARENT_TYPES.has(node.type)
}

/** A soft or a hard line break. */
export function isBreak(node: Node | undefined): boolean {
  return node !== undefined && (node.type === 'soft_break' || node.type === 'hard_break')
}

/** A JSON object: not null and not a list. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
