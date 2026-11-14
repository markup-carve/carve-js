// The public tree of contract 2.0 (spec/0.2/ast.md). `Node` (ast-nodes.ts) has one interface per
// node type, told apart by `type`; `AstNode` is the loose view of any node, in which every field is optional.
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

/** Any node, with every field of every type optional. A node of type `T` is a `NodeOfType[T]`. */
export interface AstNode {
  type: string
  children?: AstNode[]
  value?: string
  // The common fields (C2-A-027).
  attrs?: Attrs
  data?: Record<string, unknown>
  pos?: Position
  segments?: Position[]
  metadata?: Record<string, unknown>
  dir?: string
  lang?: string
  // The root (C2-A-008, C2-A-009).
  astVersion?: string
  srcByteLength?: number
  extensions?: ExtensionDeclaration[]
  stages?: string[]
  resources?: Resource[]
  // Secondary slots (C2-A-024).
  caption?: AstNode
  short?: AstNode[]
  title?: AstNode[] | string
  fallback?: AstNode[]
  slots?: Record<string, AstNode[]>
  pairs?: RubyPair[]
  prefix?: AstNode[]
  locator?: AstNode[]
  suffix?: AstNode[]
  // Fields of single node types, in the order of the node table (C2-A-050).
  key?: string
  namespace?: string
  expansion?: string
  kind?: string
  groupLabel?: string
  href?: string
  text?: string
  name?: string
  version?: string
  props?: Record<string, unknown>
  payload?: { format: string, value: string }[]
  resourceIds?: string[]
  n?: number
  blockImage?: true
  blockMath?: true
  locatorLabel?: string
  locatorValue?: string
  suppressAuthor?: boolean
  mode?: string
  number?: number
  useIndex?: boolean
  raw?: string
  syntax?: string
  form?: string
  tocTarget?: string
  level?: number
  generatedId?: string
  src?: string
  alt?: string
  decorative?: boolean
  tooltip?: string
  targetKind?: string
  resourceId?: string
  path?: string
  section?: string
  options?: [string, string][]
  marker?: Marker
  spacing?: string
  task?: Task
  display?: boolean
  numberPrefix?: string
  target?: string
  label?: string
  format?: string
  glyph?: string
  source?: string
  columns?: AstNode[]
  headRows?: number
  rowHeadColumns?: number
  header?: boolean
  span?: string
  colspan?: number
  rowspan?: number
  align?: string
  valign?: string
  width?: number
  resolvedAlign?: string
  authored?: true
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

const NONE: readonly never[] = []

/**
 * The typed view of a node of a tree the parser built or `validateTree` accepted, which has the
 * shape the node table gives its type. Readers narrow it by `type`.
 */
export function asNode(node: AstNode): Node {
  return node as Node
}

/** The children of `node`, or none. */
export function childrenOf(node: AstNode): readonly AstNode[] {
  return node.children ?? NONE
}

/** The `value` of `node`, or the empty string. */
export function valueOf(node: AstNode): string {
  return node.value ?? ''
}

/** The `key` of a reference, a definition or a term, or the empty string. */
export function keyOf(node: AstNode): string {
  return node.key ?? ''
}

/** The `href` of a link, an autolink or a link definition, or the empty string. */
export function hrefOf(node: AstNode): string {
  return node.href ?? ''
}

/** The ruby pairs of `node`, or none. */
export function pairsOf(node: AstNode): readonly RubyPair[] {
  return node.pairs ?? NONE
}

/** The columns of a table, or none. */
export function columnsOf(table: AstNode): readonly AstNode[] {
  return table.columns ?? NONE
}

/** The classes of `node`, or none (C2-A-032). */
export function classesOf(node: AstNode): readonly string[] {
  return node.attrs?.classes ?? NONE
}

/** The key-value attributes of `node`, or none (C2-A-032). */
export function keyValuesOf(node: AstNode): readonly [string, string][] {
  return node.attrs?.keyValues ?? NONE
}

/** The columns a table cell covers: 1 unless it says otherwise (C2-A-092). */
export function colspanOf(cell: AstNode): number {
  return cell.colspan ?? 1
}

/** The rows a table cell covers: 1 unless it says otherwise (C2-A-092). */
export function rowspanOf(cell: AstNode): number {
  return cell.rowspan ?? 1
}

/** The level of a heading: 1 unless it says otherwise. */
export function levelOf(heading: AstNode): number {
  return heading.level ?? 1
}

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
export function isBreak(node: AstNode | undefined): boolean {
  return node !== undefined && (node.type === 'soft_break' || node.type === 'hard_break')
}

/** A JSON object: not null and not a list. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
