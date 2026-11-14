// The public tree of contract 2.0 (spec/0.2/ast.md). `Node` (ast-nodes.ts) has one interface per
// node type, told apart by `type`.
import { type Block, type CaptionNode, type DocumentNode, type Inline, type Node, type NodeOfType } from './ast-nodes.ts'

export type * from './ast-nodes.ts'
export { FIELD_VALUES, isFieldValue } from './ast-nodes.ts'

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

/**
 * The slots any node may hold, as a walk over every node type reads them (C2-A-024, C2-A-025). Every
 * node is one, so a walk reads them as plain fields, which costs less than an `in` test per node.
 */
export interface NodeSlots {
  readonly type: string
  readonly children?: readonly Node[]
  readonly title?: Inline[] | string
  readonly caption?: CaptionNode
}

const NO_NODES: readonly Node[] = []

/** The children of `node`, or none: for a node of a type the reader has not narrowed. */
export function childNodes(node: NodeSlots): readonly Node[] {
  return node.children ?? NO_NODES
}

/** The inline title of `node`, where it has one (C2-A-024). The title of a link definition is a string and no slot. */
export function titleOf(node: NodeSlots): Inline[] | undefined {
  const title = node.title
  return typeof title === 'string' ? undefined : title
}

/** The caption of `node`, where it has one (C2-A-024). */
export function captionOf(node: NodeSlots): CaptionNode | undefined {
  return node.caption
}

/** RFC 6901: `~` and `/` in a key are written as `~0` and `~1` (C2-L-010). */
export function pointerKey(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1')
}

/** RFC 6901: a reference token with `~1` and `~0` read back as `/` and `~`, in that order. */
export function pointerToken(token: string): string {
  return token.includes('~') ? token.replaceAll('~1', '/').replaceAll('~0', '~') : token
}

/** Visits one slot of a node: its nodes, and its step in a pointer. A single node, the caption, comes as a list of one. */
export type SlotVisitor = (nodes: readonly Node[], step: string, single: boolean) => void

/** The order of a walk: that of C2-A-025, or that of the source, in which a title stands before the children. */
export const SPEC_ORDER = 0
export const SOURCE_ORDER = 1

/**
 * C2-A-024, C2-A-025: visits every slot of `node` that holds nodes: `children` first, then `caption`,
 * `short`, `prefix`, `locator` and `suffix`, the `base` and `annotation` of each ruby pair, `title`,
 * `fallback` and each named slot. In source order the title comes first. Strings, URLs, data and
 * payloads are no slots. Every walk over the nodes of a tree goes through this.
 */
export function forEachSlot(node: Node, visit: SlotVisitor, order = SPEC_ORDER): void {
  const fields = node as unknown as Readonly<Record<string, unknown>>
  const title = titleOf(node)
  if (order === SOURCE_ORDER && title !== undefined) visit(title, 'title', false)
  const children = (node as NodeSlots).children
  if (children !== undefined) visit(children, 'children', false)
  const caption = captionOf(node)
  if (caption !== undefined) visit([caption], 'caption', true)
  visitInlineSlots(node, visit)
  if (order === SPEC_ORDER && title !== undefined) visit(title, 'title', false)
  const fallback = fields['fallback'] as readonly Node[] | undefined
  if (fallback !== undefined) visit(fallback, 'fallback', false)
  const slots = fields['slots'] as Readonly<Record<string, readonly Node[]>> | undefined
  if (slots !== undefined) for (const name in slots) visit(slots[name]!, `slots/${pointerKey(name)}`, false)
}

/** The inline slots of a caption, a citation and ruby, in the order of C2-A-024. */
function visitInlineSlots(node: Node, visit: SlotVisitor): void {
  if (node.type === 'caption' && node.short !== undefined) visit(node.short, 'short', false)
  if (node.type === 'citation') {
    for (const name of ['prefix', 'locator', 'suffix'] as const) {
      const list = node[name]
      if (list !== undefined) visit(list, name, false)
    }
  }
  if (node.type === 'ruby') {
    node.pairs.forEach((pair, at) => {
      visit(pair.base, `pairs/${at}/base`, false)
      visit(pair.annotation, `pairs/${at}/annotation`, false)
    })
  }
}

/** Whether `node` is of type `type`. */
export function isNodeOfType<T extends keyof NodeOfType>(node: Node, type: T): node is NodeOfType[T] {
  return node.type === type
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
