// The public tree of contract 2.0 (spec/0.2/ast.md). `Node` (ast-nodes.ts) has one interface per
// node type, told apart by `type`.
import { type Block, type CaptionNode, type DocumentNode, type Inline, type Node, type NodeOfType } from './ast-nodes.ts'
import { NODE_SLOTS } from './ast-tables.ts'

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
}

/** C2-A-121: the structured fields of a bibliography entry. */
export interface BibliographyMetadata {
  title?: Inline[]
  containerTitle?: Inline[]
  authors?: string[]
  issued?: string
  doi?: string
  url?: string
}

/** C2-A-030: the typed metadata of a node. */
export interface Metadata {
  title?: Inline[]
  subtitle?: Inline[]
  authors?: string[]
  date?: string
  bibliography?: BibliographyMetadata
}

/** C2-A-120: a citation locator and its inline text. */
export interface CitationLocator {
  label?: string
  children: Inline[]
}

/** C2-A-181: decoded include options. */
export interface IncludeOptions {
  lines?: string
  region?: string
  rows?: string
  cols?: string | string[]
  shift?: number | 'auto'
  code?: string | true
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
  readonly title?: Inline[]
  readonly caption?: CaptionNode
}

const NO_NODES: readonly Node[] = []

/** The children of `node`, or none: for a node of a type the reader has not narrowed. */
export function childNodes(node: NodeSlots): readonly Node[] {
  return node.children ?? NO_NODES
}

/** C2-A-024: the inline title of `node`, where it has one. */
export function titleOf(node: NodeSlots): Inline[] | undefined {
  return node.title
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

// C2-A-025: metadata slots are the suffix of every generated row; this table is derived from
// NODE_SLOTS, so a new nonmetadata child slot automatically enters the walk.
const CORE_SLOTS: ReadonlyMap<string, readonly string[]> = new Map(
  [...NODE_SLOTS].map(([type, paths]) => [type, paths.filter((path) => !path.startsWith('metadata.'))]),
)

export const NO_SLOTS = 0
export const CHILDREN_ONLY = 1
export const MIXED_SLOTS = 2

/** C2-A-025: the generated row's shape, including metadata slots when metadata is present. */
export function slotShape(node: Node): 0 | 1 | 2 {
  const slots = (node.metadata === undefined ? CORE_SLOTS : NODE_SLOTS).get(node.type)
  if (slots === undefined || slots.length === 0) return NO_SLOTS
  return slots.length === 1 && slots[0] === 'children' ? CHILDREN_ONLY : MIXED_SLOTS
}

/**
 * C2-A-024, C2-A-025: visits exactly the slots of the generated node table. In source order a title
 * precedes children. Opaque data and props are not slots.
 */
export function forEachSlot(node: Node, visit: SlotVisitor, order = SPEC_ORDER): void {
  const slots = (node.metadata === undefined ? CORE_SLOTS : NODE_SLOTS).get(node.type) ?? []
  if (slots.length === 0) return
  if (slots.length === 1 && slots[0] === 'children') {
    visit(childNodes(node), 'children', false)
    return
  }
  if (order === SOURCE_ORDER && slots.includes('title')) visitSlot(node, 'title', visit)
  for (const path of slots) {
    if (order === SOURCE_ORDER && path === 'title') continue
    visitSlot(node, path, visit)
  }
}

function ownField(value: unknown, name: string): unknown {
  return isRecord(value) ? value[name] : undefined
}

function slotValue(node: Node, path: string): unknown {
  let value: unknown = node
  for (const name of path.split('.')) value = ownField(value, name)
  return value
}

function isNode(value: unknown): value is Node {
  return isRecord(value) && typeof value['type'] === 'string' && NODE_SLOTS.has(value['type'])
}

function visitSlot(node: Node, path: string, visit: SlotVisitor): void {
  if (path.endsWith('.*')) {
    const slots = slotValue(node, path.slice(0, -2))
    if (!isRecord(slots)) return
    for (const [name, value] of Object.entries(slots)) visitValue(value, `${path.slice(0, -2)}/${pointerKey(name)}`, visit)
    return
  }
  visitValue(slotValue(node, path), path.replaceAll('.', '/'), visit)
}

function visitValue(value: unknown, step: string, visit: SlotVisitor): void {
  if (isNode(value)) visit([value], step, true)
  else if (isNodeList(value)) visit(value, step, false)
}

function isNodeList(value: unknown): value is Node[] {
  return Array.isArray(value) && (value.length === 0 || isNode(value[0]))
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
