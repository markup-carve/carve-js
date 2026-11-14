// Generated from the node table of src/ast-validate.ts by scripts/generate-ast-nodes.ts. Do not edit.
import { type Attrs, type ExtensionDeclaration, type Marker, type Position, type Resource, type RubyPair, type Task } from './ast.ts'

/** C2-A-027: the fields every node may carry. */
export interface NodeBase {
  attrs?: Attrs
  data?: Record<string, unknown>
  pos?: Position
  segments?: Position[]
  metadata?: Record<string, unknown>
  dir?: "ltr" | "rtl" | "auto"
  lang?: string
}

export interface AbbreviationNode extends NodeBase {
  type: "abbreviation"
  key: string
  namespace: "abbr"
  expansion?: string
}

export interface AbbreviationDefNode extends NodeBase {
  type: "abbreviation_def"
  expansion: string
  key: string
  namespace: "abbr"
}

export interface AdmonitionNode extends NodeBase {
  type: "admonition"
  children: Block[]
  kind: "note" | "tip" | "warning" | "danger" | "info" | "success" | "example" | "quote"
  title?: Inline[]
  groupLabel?: string
}

export interface AutolinkNode extends NodeBase {
  type: "autolink"
  href: string
  text?: string
}

export interface BlockExtensionNode extends NodeBase {
  type: "block_extension"
  children: Block[]
  name: string
  fallback: Block[]
  version?: string
  props?: Record<string, unknown>
  slots?: Record<string, Node[]>
  payload?: { format: string, value: string }[]
  resourceIds?: string[]
}

export interface BlockQuoteNode extends NodeBase {
  type: "block_quote"
  children: Block[]
}

export interface CaptionNode extends NodeBase {
  type: "caption"
  children: Block[]
  short?: Inline[]
}

export interface CaptionNumberNode extends NodeBase {
  type: "caption_number"
  n?: number
}

export interface CellParagraphNode extends NodeBase {
  type: "cell_paragraph"
  children: Inline[]
  blockImage?: true
}

export interface CitationNode extends NodeBase {
  type: "citation"
  key: string
  suppressAuthor: boolean
  namespace: "citation"
  prefix?: Inline[]
  locator?: Inline[]
  locatorLabel?: string
  locatorValue?: string
  suffix?: Inline[]
  mode?: string
  number?: number
  useIndex?: boolean
}

export interface CitationDefinitionNode extends NodeBase {
  type: "citation_definition"
  children: Inline[]
  key: string
  namespace: "citation"
}

export interface CitationGroupNode extends NodeBase {
  type: "citation_group"
  children: CitationNode[]
  raw: string
  mode?: string
}

export interface CodeNode extends NodeBase {
  type: "code"
  value: string
}

export interface CodeBlockNode extends NodeBase {
  type: "code_block"
  value: string
  syntax?: string
  title?: Inline[]
  groupLabel?: string
}

export interface CommentNode extends NodeBase {
  type: "comment"
  form: "block" | "line" | "braced"
  value: string
}

export interface CriticCommentNode extends NodeBase {
  type: "critic_comment"
  value: string
}

export interface DefinitionDescriptionNode extends NodeBase {
  type: "definition_description"
  children: Block[]
}

export interface DefinitionListNode extends NodeBase {
  type: "definition_list"
  children: (DefinitionTermNode | DefinitionDescriptionNode | CommentNode)[]
}

export interface DefinitionTermNode extends NodeBase {
  type: "definition_term"
  children: Inline[]
}

export interface DeleteNode extends NodeBase {
  type: "delete"
  children: Inline[]
}

export interface DirectiveNode extends NodeBase {
  type: "directive"
  children: Block[]
  kind: "bibliography" | "footnotes" | "glossary" | "index" | "references" | "toc"
  title?: Inline[]
  groupLabel?: string
  tocTarget?: "headings" | "figures" | "tables" | "listings"
}

export interface DivNode extends NodeBase {
  type: "div"
  children: Block[]
  title?: Inline[]
  groupLabel?: string
}

export interface DocumentNode extends NodeBase {
  type: "document"
  children: (Block | FootnoteNode | LinkReferenceDefinitionNode | AbbreviationDefNode | CitationDefinitionNode | FrontmatterNode)[]
  astVersion: string
  srcByteLength?: number
  extensions?: ExtensionDeclaration[]
  stages?: ("referenceResolution" | "tableAlignment")[]
  resources?: Resource[]
}

export interface EmphasisNode extends NodeBase {
  type: "emphasis"
  children: Inline[]
}

export interface FigureNode extends NodeBase {
  type: "figure"
  children: Block[]
  caption?: CaptionNode
  kind?: "image" | "table" | "listing" | "equation" | "other"
}

export interface FigureGroupNode extends NodeBase {
  type: "figure_group"
  children: Block[]
  caption?: CaptionNode
}

export interface FootnoteNode extends NodeBase {
  type: "footnote"
  children: Block[]
  key: string
  namespace: "footnote"
}

export interface FootnoteRefNode extends NodeBase {
  type: "footnote_ref"
  key: string
  namespace: "footnote"
  number?: number
}

export interface FrontmatterNode extends NodeBase {
  type: "frontmatter"
  format: string
  value: string
}

export interface HardBreakNode extends NodeBase {
  type: "hard_break"
}

export interface HeadingNode extends NodeBase {
  type: "heading"
  children: Inline[]
  level: number
  generatedId?: string
}

export interface HighlightNode extends NodeBase {
  type: "highlight"
  children: Inline[]
}

export interface ImageNode extends NodeBase {
  type: "image"
  src?: string
  alt?: string
  decorative?: boolean
  tooltip?: string
  targetKind?: "url" | "wiki" | "doc" | "xref"
  key?: string
  namespace?: "link"
  resourceId?: string
  form?: "full" | "collapsed"
}

export interface IncludeNode extends NodeBase {
  type: "include"
  path: string
  section?: string
  options?: [string, string][]
}

export interface InlineExtensionNode extends NodeBase {
  type: "inline_extension"
  children: Inline[]
  name: string
  version?: string
  props?: Record<string, unknown>
  slots?: Record<string, Node[]>
  payload?: { format: string, value: string }[]
  resourceIds?: string[]
  fallback?: Inline[]
}

export interface InlineFootnoteNode extends NodeBase {
  type: "inline_footnote"
  children: Inline[]
  number?: number
}

export interface InsertNode extends NodeBase {
  type: "insert"
  children: Inline[]
}

export interface LineNode extends NodeBase {
  type: "line"
  children: Inline[]
}

export interface LineBlockNode extends NodeBase {
  type: "line_block"
  children: LineNode[]
}

export interface LinkNode extends NodeBase {
  type: "link"
  children: Inline[]
  href?: string
  tooltip?: string
  targetKind?: "url" | "wiki" | "doc" | "xref"
  key?: string
  namespace?: "link"
  form?: "full" | "collapsed"
}

export interface LinkReferenceDefinitionNode extends NodeBase {
  type: "link_reference_definition"
  href: string
  key: string
  namespace: "link"
  title?: string
}

export interface ListNode extends NodeBase {
  type: "list"
  children: ListItemNode[]
  marker: Marker
  spacing: "tight" | "loose"
}

export interface ListItemNode extends NodeBase {
  type: "list_item"
  children: Block[]
  task?: Task
}

export interface LiteralInlineNode extends NodeBase {
  type: "literal_inline"
  value: string
}

export interface MathNode extends NodeBase {
  type: "math"
  display: boolean
  value: string
  number?: number
  numberPrefix?: string
}

export interface MentionNode extends NodeBase {
  type: "mention"
  target: string
  kind: string
  label?: string
}

export interface NonBreakingSpaceNode extends NodeBase {
  type: "non_breaking_space"
}

export interface ParagraphNode extends NodeBase {
  type: "paragraph"
  children: Inline[]
  blockImage?: true
  blockMath?: true
}

export interface RawBlockNode extends NodeBase {
  type: "raw_block"
  format: string
  value: string
}

export interface RawInlineNode extends NodeBase {
  type: "raw_inline"
  format: string
  value: string
}

export interface RubyNode extends NodeBase {
  type: "ruby"
  pairs: RubyPair[]
}

export interface SectionNode extends NodeBase {
  type: "section"
  children: Block[]
  level?: number
}

export interface SmallCapsNode extends NodeBase {
  type: "small_caps"
  children: Inline[]
}

export interface SmartPunctuationNode extends NodeBase {
  type: "smart_punctuation"
  kind: string
  source: string
  glyph?: string
}

export interface SoftBreakNode extends NodeBase {
  type: "soft_break"
}

export interface SpanNode extends NodeBase {
  type: "span"
  children: Inline[]
}

export interface StrikeNode extends NodeBase {
  type: "strike"
  children: Inline[]
}

export interface StrongNode extends NodeBase {
  type: "strong"
  children: Inline[]
}

export interface SubscriptNode extends NodeBase {
  type: "subscript"
  children: Inline[]
}

export interface SuperscriptNode extends NodeBase {
  type: "superscript"
  children: Inline[]
}

export interface SymbolNode extends NodeBase {
  type: "symbol"
  name: string
}

export interface TableNode extends NodeBase {
  type: "table"
  children: (TableHeadNode | TableBodyNode | TableFootNode | CommentNode)[]
  columns: TableColumnNode[]
  caption?: CaptionNode
}

export interface TableBodyNode extends NodeBase {
  type: "table_body"
  children: (TableRowNode | CommentNode)[]
  headRows?: number
  rowHeadColumns?: number
}

export interface TableCellNode extends NodeBase {
  type: "table_cell"
  children: (Block | CellParagraphNode)[]
  header: boolean
  span?: "rowspan" | "colspan"
  colspan?: number
  rowspan?: number
  align?: "left" | "right" | "center"
  valign?: string
}

export interface TableColumnNode extends NodeBase {
  type: "table_column"
  align?: "left" | "right" | "center"
  valign?: string
  width?: number
  resolvedAlign?: "left" | "right" | "center"
  authored?: true
}

export interface TableFootNode extends NodeBase {
  type: "table_foot"
  children: (TableRowNode | CommentNode)[]
}

export interface TableHeadNode extends NodeBase {
  type: "table_head"
  children: (TableRowNode | CommentNode)[]
}

export interface TableRowNode extends NodeBase {
  type: "table_row"
  children: TableCellNode[]
}

export interface TagNode extends NodeBase {
  type: "tag"
  name: string
}

export interface TextNode extends NodeBase {
  type: "text"
  value: string
}

export interface ThematicBreakNode extends NodeBase {
  type: "thematic_break"
}

export interface UnderlineNode extends NodeBase {
  type: "underline"
  children: Inline[]
}

export interface XrefNode extends NodeBase {
  type: "xref"
  key: string
  namespace: "link" | "footnote" | "citation" | "abbr" | "heading"
  href?: string
  form?: "number" | "page" | "title" | "full"
}

/** The node types that stand in a list of blocks. */
export type Block =
  | AdmonitionNode
  | BlockExtensionNode
  | BlockQuoteNode
  | CodeBlockNode
  | CommentNode
  | DefinitionListNode
  | DirectiveNode
  | DivNode
  | FigureNode
  | FigureGroupNode
  | HeadingNode
  | IncludeNode
  | LineBlockNode
  | ListNode
  | ParagraphNode
  | RawBlockNode
  | SectionNode
  | TableNode
  | ThematicBreakNode

/** The node types that stand in a list of inlines. */
export type Inline =
  | AbbreviationNode
  | AutolinkNode
  | CaptionNumberNode
  | CitationGroupNode
  | CodeNode
  | CommentNode
  | CriticCommentNode
  | DeleteNode
  | EmphasisNode
  | FootnoteRefNode
  | HardBreakNode
  | HighlightNode
  | ImageNode
  | InlineExtensionNode
  | InlineFootnoteNode
  | InsertNode
  | LinkNode
  | LiteralInlineNode
  | MathNode
  | MentionNode
  | NonBreakingSpaceNode
  | RawInlineNode
  | RubyNode
  | SmallCapsNode
  | SmartPunctuationNode
  | SoftBreakNode
  | SpanNode
  | StrikeNode
  | StrongNode
  | SubscriptNode
  | SuperscriptNode
  | SymbolNode
  | TagNode
  | TextNode
  | UnderlineNode
  | XrefNode

/** Every node of the tree document, told apart by `type`. */
export type Node =
  | AbbreviationNode
  | AbbreviationDefNode
  | AdmonitionNode
  | AutolinkNode
  | BlockExtensionNode
  | BlockQuoteNode
  | CaptionNode
  | CaptionNumberNode
  | CellParagraphNode
  | CitationNode
  | CitationDefinitionNode
  | CitationGroupNode
  | CodeNode
  | CodeBlockNode
  | CommentNode
  | CriticCommentNode
  | DefinitionDescriptionNode
  | DefinitionListNode
  | DefinitionTermNode
  | DeleteNode
  | DirectiveNode
  | DivNode
  | DocumentNode
  | EmphasisNode
  | FigureNode
  | FigureGroupNode
  | FootnoteNode
  | FootnoteRefNode
  | FrontmatterNode
  | HardBreakNode
  | HeadingNode
  | HighlightNode
  | ImageNode
  | IncludeNode
  | InlineExtensionNode
  | InlineFootnoteNode
  | InsertNode
  | LineNode
  | LineBlockNode
  | LinkNode
  | LinkReferenceDefinitionNode
  | ListNode
  | ListItemNode
  | LiteralInlineNode
  | MathNode
  | MentionNode
  | NonBreakingSpaceNode
  | ParagraphNode
  | RawBlockNode
  | RawInlineNode
  | RubyNode
  | SectionNode
  | SmallCapsNode
  | SmartPunctuationNode
  | SoftBreakNode
  | SpanNode
  | StrikeNode
  | StrongNode
  | SubscriptNode
  | SuperscriptNode
  | SymbolNode
  | TableNode
  | TableBodyNode
  | TableCellNode
  | TableColumnNode
  | TableFootNode
  | TableHeadNode
  | TableRowNode
  | TagNode
  | TextNode
  | ThematicBreakNode
  | UnderlineNode
  | XrefNode

/** The node of each type. */
export interface NodeOfType {
  abbreviation: AbbreviationNode
  abbreviation_def: AbbreviationDefNode
  admonition: AdmonitionNode
  autolink: AutolinkNode
  block_extension: BlockExtensionNode
  block_quote: BlockQuoteNode
  caption: CaptionNode
  caption_number: CaptionNumberNode
  cell_paragraph: CellParagraphNode
  citation: CitationNode
  citation_definition: CitationDefinitionNode
  citation_group: CitationGroupNode
  code: CodeNode
  code_block: CodeBlockNode
  comment: CommentNode
  critic_comment: CriticCommentNode
  definition_description: DefinitionDescriptionNode
  definition_list: DefinitionListNode
  definition_term: DefinitionTermNode
  delete: DeleteNode
  directive: DirectiveNode
  div: DivNode
  document: DocumentNode
  emphasis: EmphasisNode
  figure: FigureNode
  figure_group: FigureGroupNode
  footnote: FootnoteNode
  footnote_ref: FootnoteRefNode
  frontmatter: FrontmatterNode
  hard_break: HardBreakNode
  heading: HeadingNode
  highlight: HighlightNode
  image: ImageNode
  include: IncludeNode
  inline_extension: InlineExtensionNode
  inline_footnote: InlineFootnoteNode
  insert: InsertNode
  line: LineNode
  line_block: LineBlockNode
  link: LinkNode
  link_reference_definition: LinkReferenceDefinitionNode
  list: ListNode
  list_item: ListItemNode
  literal_inline: LiteralInlineNode
  math: MathNode
  mention: MentionNode
  non_breaking_space: NonBreakingSpaceNode
  paragraph: ParagraphNode
  raw_block: RawBlockNode
  raw_inline: RawInlineNode
  ruby: RubyNode
  section: SectionNode
  small_caps: SmallCapsNode
  smart_punctuation: SmartPunctuationNode
  soft_break: SoftBreakNode
  span: SpanNode
  strike: StrikeNode
  strong: StrongNode
  subscript: SubscriptNode
  superscript: SuperscriptNode
  symbol: SymbolNode
  table: TableNode
  table_body: TableBodyNode
  table_cell: TableCellNode
  table_column: TableColumnNode
  table_foot: TableFootNode
  table_head: TableHeadNode
  table_row: TableRowNode
  tag: TagNode
  text: TextNode
  thematic_break: ThematicBreakNode
  underline: UnderlineNode
  xref: XrefNode
}

/**
 * A function per node type, each of which reads a node of its own type and what the caller passes along.
 * A table is read through a dispatcher of its own, `table[type]?.(node, context)` with `type` and `node`
 * typed by one parameter `T extends keyof NodeOfType`: one shared dispatcher for every table loses speed.
 */
export type NodeHandlers<R, C = void> = { [T in keyof NodeOfType]?: (node: NodeOfType[T], context: C) => R }

/** The values of each field that takes one of a fixed set, by `type.field` (`*` for any type). */
export const FIELD_VALUES = {
  "*.dir": ["ltr", "rtl", "auto"],
  "comment.form": ["block", "line", "braced"],
  "link.form": ["full", "collapsed"],
  "image.form": ["full", "collapsed"],
  "xref.form": ["number", "page", "title", "full"],
  "list.spacing": ["tight", "loose"],
  "table_cell.span": ["rowspan", "colspan"],
  "table_cell.align": ["left", "right", "center"],
  "table_column.align": ["left", "right", "center"],
  "table_column.resolvedAlign": ["left", "right", "center"],
  "link.targetKind": ["url", "wiki", "doc", "xref"],
  "image.targetKind": ["url", "wiki", "doc", "xref"],
  "directive.tocTarget": ["headings", "figures", "tables", "listings"],
  "directive.kind": ["bibliography", "footnotes", "glossary", "index", "references", "toc"],
  "figure.kind": ["image", "table", "listing", "equation", "other"],
  "admonition.kind": ["note", "tip", "warning", "danger", "info", "success", "example", "quote"],
  "*.namespace": ["link", "footnote", "citation", "abbr", "heading"],
  "link.namespace": ["link"],
  "image.namespace": ["link"],
  "link_reference_definition.namespace": ["link"],
  "footnote_ref.namespace": ["footnote"],
  "footnote.namespace": ["footnote"],
  "abbreviation.namespace": ["abbr"],
  "abbreviation_def.namespace": ["abbr"],
  "citation.namespace": ["citation"],
  "citation_definition.namespace": ["citation"],
} as const

/** Whether `value` is one of the values of `field`. */
export function isFieldValue<F extends keyof typeof FIELD_VALUES>(
  field: F, value: string,
): value is (typeof FIELD_VALUES)[F][number] {
  return FIELD_VALUES[field].some((allowed) => allowed === value)
}
