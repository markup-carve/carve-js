// The public tree of contract 2.0 (spec/0.2/ast.md). One interface for every node type: a node
// carries `type` and the fields its type has, and nothing it does not use (C2-A-021, C2-A-028).

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
  base: AstNode[]
  annotation: AstNode[]
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
  width?: string
  resolvedAlign?: string
  authored?: true
}

/** C2-A-012: the envelope a tree travels in at a storage or process boundary. */
export interface Envelope {
  astVersion: string
  document: AstNode
  vocabulary?: string
  extensions?: ExtensionDeclaration[]
}

export const DEFINITION_TYPES: readonly string[] = ['footnote', 'link_reference_definition', 'abbreviation_def', 'citation_definition']

/** The node types with inline content in `children`. */
export const INLINE_PARENTS: readonly string[] = [
  'paragraph', 'heading', 'definition_term', 'cell_paragraph', 'line', 'citation_definition', 'emphasis', 'strong',
  'underline', 'strike', 'highlight', 'superscript', 'subscript', 'insert', 'delete', 'span', 'link', 'inline_footnote',
  'inline_extension', 'small_caps',
]
