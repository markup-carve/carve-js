// Resolution (C2-A-103 to C2-A-117, C2-A-133 to C2-A-135): references against definitions and
// headings, footnote numbers, heading ids, caption numbers, cross-references and column alignment.
// The results are written into the tree beside the authored constructs; what a renderer needs
// besides them is returned.
import {
  type AbbreviationDefNode, type AdmonitionNode, type BlockQuoteNode, type CaptionNode, type CodeBlockNode, type DirectiveNode,
  type DivNode,
  type DocumentNode, type ExtensionDeclaration, type FigureGroupNode, type FootnoteNode, type FootnoteRefNode,
  type HeadingNode, type ImageNode, type IncludeNode, type Inline, type InlineFootnoteNode, type LinkNode, type LinkReferenceDefinitionNode,
  CHILDREN_ONLY, childNodes, forEachSlot, NO_SLOTS, slotShape, SOURCE_ORDER, type MathNode, type Node, isNodeOfType,
  type NodeOfType, type ParagraphNode,
  type TableCellNode, type TableNode,
  type TableRowNode, type XrefNode,
} from './ast.ts'
import { inlineContent, type ParseFacts } from './ast-blocks.ts'
import { foldLabel } from './ast-attributes.ts'
import { captionLabelText, plainText } from './ast-text.ts'
import { addFinding, type Diagnostic, type Findings } from './diagnostics.ts'
import { type HeadingIds } from './options.ts'
import { slugify } from './slug.ts'
import { trimEndWhitespace } from './source.ts'

export { type Diagnostic } from './diagnostics.ts'

/** One numbered footnote: a definition that a reference uses, or an inline footnote. */
export interface Note {
  number: number
  definition: FootnoteNode | null
  inline: InlineFootnoteNode | null
  /** The ids of its references in the order of the document, for the backlinks (C2-H-091). */
  refIds: string[]
}

export interface Resolution {
  definitions: Map<string, LinkReferenceDefinitionNode>
  /** C2-N-054: the definition a reference in an included file resolved to, where it is not the document's own. */
  definitionOf: Map<Node, LinkReferenceDefinitionNode>
  notes: Note[]
  noteOf: Map<Node, Note>
  refIds: Map<Node, string>
  /** The generated text of each resolved cross-reference (C2-H-096). */
  xrefText: Map<Node, string>
  /** C2-H-156: the generated id of the title of each admonition and of the directive that places the notes. */
  labelIds: Map<Node, string>
  /** The findings of resolution, each with its node. `diagnostics` is the list of its entries. */
  findings: Findings
  diagnostics: Diagnostic[]
  /** C2-H-177: for a render under a profile, the `#id` targets of the degraded headings. */
  goneTargets?: ReadonlySet<string>
  /** C2-H-062: the line of the own markup of each captioned block of a parse that took attribute lines. */
  markupLines: Map<Node, number>
}

/** C2-A-082: a block that carries its caption in its own slot. */
type CaptionHost = FigureGroupNode | TableNode | ParagraphNode | CodeBlockNode | BlockQuoteNode | IncludeNode

/** One taker of a sequence number: a caption with its host, or a numbered equation of a supplied tree (C2-H-151). */
type CaptionUse =
  | { caption: CaptionNode, host: CaptionHost, panel: boolean }
  | { caption: null, host: MathNode, prefix: string }

/** A link or an image written as a reference (C2-A-105). */
type Reference = LinkNode | ImageNode

/** C2-N-053 to C2-N-055: the definitions of one file, and the scope of the file that includes it. */
interface Scope {
  outer: Scope | null
  definitions: Map<string, LinkReferenceDefinitionNode>
  footnotes: Map<string, FootnoteNode>
}

interface Walk {
  declarations: readonly ExtensionDeclaration[]
  resolution: Resolution
  footnotes: Map<string, FootnoteNode>
  /** The scope of the file of the node that is visited. */
  scope: Scope
  /** The scope of each reference and note body that stands in an included file. */
  scopes: Map<Node, Scope>
  headings: HeadingNode[]
  references: Reference[]
  xrefs: XrefNode[]
  captions: CaptionUse[]
  identified: Node[]
  /** C2-H-156: the titled admonitions and the titled top-level `footnotes` directives, in the order of the walk. */
  titled: (AdmonitionNode | DirectiveNode)[]
  /** C2-H-093: the first top-level `footnotes` directive. */
  notesDirective: DirectiveNode | null
  /** C2-H-151: the figures and figure groups around the node that is visited whose caption has a number mark. */
  numberedFigures: number
  symbols: Readonly<Record<string, string>>
  /** The leaves of a parsed tree that the walk goes into, or null for a tree of which nothing is known. */
  resolvableLeaves: ReadonlySet<Node> | null
  /** The parent of the node whose visitor runs. A visitor reads it before it visits anything below. */
  parent: Node | null
  markupLine: ((node: Node) => number | undefined) | null
}

/** C2-W-113: a duplicate is a finding of the parse channel, reported on the later node. */
function report(resolution: Resolution, node: Node, code: string, message: string): void {
  addFinding(resolution.findings, node, { code, severity: 'warning', channel: 'parse', message })
}

/** C2-H-087, C2-H-088: the note of a reference takes the next number at its first reference. */
function useNote(walk: Walk, node: FootnoteRefNode | InlineFootnoteNode, definition: FootnoteNode | null): void {
  const resolution = walk.resolution
  let note = definition === null ? undefined : resolution.noteOf.get(definition)
  if (note === undefined) {
    note = { number: resolution.notes.length + 1, definition, inline: node.type === 'inline_footnote' ? node : null, refIds: [] }
    resolution.notes.push(note)
    if (definition !== null) resolution.noteOf.set(definition, note)
  }
  const ordinal = note.refIds.length + 1
  const id = node.attrs?.id ?? (ordinal === 1 ? `fnref${note.number}` : `fnref${note.number}-${ordinal}`)
  note.refIds.push(id)
  resolution.noteOf.set(node, note)
  resolution.refIds.set(node, id)
  node.number = note.number
}

/** C2-N-055: the definition of `key` in the file of the walk, then in each file further out. */
function lookUp<T>(scope: Scope, key: string, table: (scope: Scope) => Map<string, T>): T | undefined {
  for (let at: Scope | null = scope; at !== null; at = at.outer) {
    const found = table(at).get(key)
    if (found !== undefined) return found
  }
  return undefined
}

function visitFootnoteRef(node: FootnoteRefNode, walk: Walk): void {
  const definition = lookUp(walk.scope, node.key, (scope) => scope.footnotes)
  if (definition === undefined) {
    delete node.number
    return
  }
  useNote(walk, node, definition)
  if (walk.scope.outer !== null) walk.scopes.set(node, walk.scope)
}

function visitHost(node: CaptionHost, walk: Walk): void {
  // C2-A-084: the panels of a group are its tables and its captioned blocks; a nested group is a group of its own.
  const panel = walk.parent?.type === 'figure_group' && node.type !== 'figure_group'
  if (node.type === 'table') alignColumns(node)
  if (node.caption !== undefined) walk.captions.push({ caption: node.caption, host: node, panel })
  const line = node.caption === undefined || node.type === 'table' ? undefined : walk.markupLine?.(node)
  if (line !== undefined) walk.resolution.markupLines.set(node, line)
  visitSlots(walk, node)
}

/** C2-H-151: a display equation with a prefix takes a number, unless the caption of a figure around it owns the number. */
function visitMath(node: MathNode, walk: Walk): void {
  delete node.number
  if (node.display && node.numberPrefix !== undefined && walk.numberedFigures === 0) {
    walk.captions.push({ caption: null, host: node, prefix: node.numberPrefix })
  }
}

/** The inline content of the paragraph of a caption (C2-A-081), or none. */
function captionInlines(caption: CaptionNode): Inline[] {
  const first = caption.children[0]
  return first?.type === 'paragraph' || first?.type === 'heading' ? first.children : []
}

/** True for a captioned block or a figure group whose caption, `caption`, has a number mark. A table owns no number of an equation. */
function ownsNumber(node: Node, caption: CaptionNode): boolean {
  if (node.type === 'table') return false
  return captionInlines(caption).some((child) => child.type === 'caption_number')
}

const NAMING_KEYS = ['aria-label', 'aria-labelledby']

/** C2-H-155: true when the attribute line names the node itself, so the renderer generates no name and no id. */
export function hasAuthoredName(node: Node): boolean {
  return node.attrs?.keyValues?.some(([key]) => NAMING_KEYS.includes(key.toLowerCase())) === true
}

function visitAdmonition(node: AdmonitionNode, walk: Walk): void {
  if (node.title !== undefined && !hasAuthoredName(node)) walk.titled.push(node)
  visitSlots(walk, node)
}

function visitDirective(node: DirectiveNode, walk: Walk): void {
  if (node.kind === 'footnotes' && walk.parent?.type === 'document') {
    walk.notesDirective ??= node
    if (node.title !== undefined) walk.titled.push(node)
  }
  visitSlots(walk, node)
}

function visitReference(node: Reference, walk: Walk): void {
  if (node.key === undefined) return
  walk.references.push(node)
  if (walk.scope.outer !== null) walk.scopes.set(node, walk.scope)
}

/** C2-N-053: the scope of an included file, with its own definitions; the first of a key wins within the file (C2-N-060). */
function fileScope(walk: Walk, node: IncludeNode, outer: Scope): Scope {
  const scope: Scope = { outer, definitions: new Map(), footnotes: new Map() }
  const abbreviations = new Map<string, AbbreviationDefNode>()
  for (const child of node.children ?? []) {
    if (child.type === 'abbreviation_def') define(walk, abbreviations, child, 'duplicate-abbreviation-definition', ABBREVIATION_DUPLICATE)
    if (child.type === 'link_reference_definition') {
      define(walk, scope.definitions, child, 'duplicate-link-reference-definition', LINK_DUPLICATE)
    } else if (child.type === 'footnote') {
      define(walk, scope.footnotes, child, 'duplicate-footnote-definition', footnoteDuplicate(null))
      walk.scopes.set(child, scope)
    }
  }
  return scope
}

/** C2-N-053, C2-N-072: the children of an expanded include are read in the scope of their file; its own attributes are inert. */
function visitInclude(node: IncludeNode, walk: Walk): void {
  const children = node.children
  // C2-N-074: the caption of an unexpanded include is numbered where it stands; that of an expanded one is not.
  if (children === undefined) {
    if (node.caption !== undefined) walk.captions.push({ caption: node.caption, host: node, panel: false })
    return
  }
  const outer = walk.scope
  walk.scope = fileScope(walk, node, outer)
  walk.scopes.set(node, walk.scope)
  for (const child of children) visit(walk, child, node)
  walk.scope = outer
}

// What the walk does below a node of a type, besides its visitor. A note is opaque: its content is
// visited with the notes. A leaf is inline content that a parse may know to hold nothing that
// resolution reads. A node with a title or a caption visits them in its visitor.
const NOTHING = 0
const CHILDREN = 1
const LEAF = 2

interface Step {
  visit: ((node: Node, walk: Walk) => void) | null
  below: number
}

/** The step of `type`: `visit` takes a node of that type. */
function on<T extends keyof NodeOfType>(type: T, below: number, visit: ((node: NodeOfType[T], walk: Walk) => void) | null): [string, Step] {
  if (visit === null) return [type, { visit: null, below }]
  return [type, {
    visit: (node, walk) => {
      if (isNodeOfType(node, type)) visit(node, walk)
    },
    below,
  }]
}

/** The steps of the node types the walk does more at than visit the children. */
const STEPS = new Map<string, Step>([
  on('footnote_ref', NOTHING, visitFootnoteRef),
  on('inline_footnote', NOTHING, (node, walk) => {
    useNote(walk, node, null)
    if (walk.scope.outer !== null) walk.scopes.set(node, walk.scope)
  }),
  on('footnote', NOTHING, null),
  on('heading', LEAF, (node, walk) => void walk.headings.push(node)),
  on('paragraph', LEAF, null),
  on('definition_term', LEAF, null),
  on('cell_paragraph', LEAF, null),
  on('line', LEAF, null),
  on('link', CHILDREN, visitReference),
  on('image', NOTHING, visitReference),
  on('xref', NOTHING, (node, walk) => void walk.xrefs.push(node)),
  on('figure_group', NOTHING, visitHost),
  on('table', NOTHING, visitHost),
  on('math', NOTHING, visitMath),
  on('admonition', NOTHING, visitAdmonition),
  on('directive', NOTHING, visitDirective),
  on('div', NOTHING, (node, walk) => visitSlots(walk, node)),
  on('include', NOTHING, visitInclude),
])

/**
 * Visits the nodes of every slot of `node`, in document order: a title before the children, as
 * C2-L-011 orders the slots, since numbers count in document order (C2-H-024, C2-H-149). Text is
 * skipped here and not in the call: half of the nodes of a document are text.
 */
function visitChildren(walk: Walk, node: Node): void {
  const shape = slotShape(node)
  if (shape === NO_SLOTS) return
  if (shape === CHILDREN_ONLY) {
    for (const child of childNodes(node)) if (child.type !== 'text') visit(walk, child, node)
    return
  }
  forEachSlot(node, (nodes) => {
    for (const child of nodes) if (child.type !== 'text') visit(walk, child, node)
  }, SOURCE_ORDER, walk.declarations)
}

/** The slots of a node that may carry a title or a caption (C2-A-025); a caption that owns a number counts the figures below it. */
function visitSlots(walk: Walk, node: CaptionHost | AdmonitionNode | DirectiveNode | DivNode): void {
  const caption = 'caption' in node ? node.caption : undefined
  const owns = caption !== undefined && ownsNumber(node, caption)
  forEachSlot(node, (nodes, step) => {
    if (owns && step === 'children') walk.numberedFigures++
    for (const child of nodes) if (child.type !== 'text') visit(walk, child, node)
    if (owns && step === 'children') walk.numberedFigures--
  }, SOURCE_ORDER, walk.declarations)
}

/** C2-A-082: an image paragraph, a math block, a code block or a quote that carries a caption. */
function isCaptionedBlock(node: Node): node is ParagraphNode | CodeBlockNode | BlockQuoteNode {
  return (node.type === 'paragraph' || node.type === 'code_block' || node.type === 'block_quote') && node.caption !== undefined
}

/** Whether the leaf `node` may hold a node that resolution reads: any leaf of a supplied tree, and the noted leaves of a parse. */
function mayResolve(walk: Walk, node: Node): boolean {
  return walk.resolvableLeaves === null || walk.resolvableLeaves.has(node)
}

/**
 * Visits `node` and the nodes below it in document order. A note is visited with the notes, not
 * where it stands, and a leaf of a parsed tree is entered only where the parse saw a node that
 * resolution reads.
 */
function visit(walk: Walk, node: Node, parent: Node | null): void {
  if (node.attrs?.id !== undefined && node.type !== 'include') walk.identified.push(node)
  if (isCaptionedBlock(node)) {
    walk.parent = parent
    return visitHost(node, walk)
  }
  const step = STEPS.get(node.type)
  if (step === undefined) return visitChildren(walk, node)
  if (step.visit !== null) {
    walk.parent = parent
    step.visit(node, walk)
  }
  if (step.below === CHILDREN || (step.below === LEAF && mayResolve(walk, node))) visitChildren(walk, node)
}

/**
 * The marks of one head row, each at the column its cell starts in (C2-A-092, C2-A-093). `covered`
 * counts the rows a cell above still spans.
 */
function rowMarks<F extends 'align' | 'valign'>(row: TableRowNode, field: F, covered: number[], marks: TableCellNode[F][]): void {
  const cells = row.children
  const marked = cells.some((cell) => cell.span !== undefined)
  let column = 0
  for (const cell of cells) {
    while (!marked && (covered[column] ?? 0) > 0) covered[column++]!--
    const mark = cell[field]
    if (mark !== undefined) marks[column] = mark
    const colspan = cell.colspan ?? 1
    if (!marked) for (let more = 0; more < colspan; more++) covered[column + more] = (cell.rowspan ?? 1) - 1
    column += marked ? 1 : colspan
  }
}

/**
 * C2-B-213: the mark each column takes from the head, on one axis: that of the last head cell
 * that starts in the column and has one. A cell that spans several columns marks only the first.
 */
export function headMarks<F extends 'align' | 'valign'>(table: TableNode, field: F): TableCellNode[F][] {
  const marks: TableCellNode[F][] = []
  for (const group of table.children) {
    if (group.type !== 'table_head') continue
    const covered: number[] = []
    for (const row of group.children) if (row.type === 'table_row') rowMarks(row, field, covered, marks)
  }
  return marks
}

/** C2-B-213: the resolved alignment of a column is the mark of its head cell, or else what `aligns` spelled. */
function alignColumns(table: TableNode): void {
  const columns = table.columns
  if (columns.length === 0) return
  const fromHead = headMarks(table, 'align')
  columns.forEach((column, at) => {
    const align = fromHead[at] ?? column.align
    if (align === undefined) delete column.resolvedAlign
    else column.resolvedAlign = align
  })
}


/** Enters `node` under its key in `table`, unless an earlier definition holds the key, which is reported with `message`. */
function define<N extends FootnoteNode | LinkReferenceDefinitionNode | AbbreviationDefNode>(
  walk: Walk, table: Map<string, N>, node: N, code: string, message: (node: N) => string,
): void {
  if (table.has(node.key)) report(walk.resolution, node, code, message(node))
  else table.set(node.key, node)
}

const LINK_DUPLICATE = (): string => 'Duplicate link definition (label) is ignored; the first definition for a label wins.'
const ABBREVIATION_DUPLICATE = (): string => 'Duplicate abbreviation definition (label) is ignored; the first definition for a label wins.'

/** C2-B-085: a losing footnote definition takes its content with it, which the message counts past the first line. */
function footnoteDuplicate(facts: ParseFacts | null): (node: FootnoteNode) => string {
  return (node) => {
    const lines = facts?.footnoteLines(node) ?? 0
    const lost = lines > 1 ? ` Its ${lines} lines of content are lost with it.` : ''
    return `Duplicate footnote definition [^${node.key}] is ignored; the first definition for a label wins.${lost}`
  }
}

/** C2-B-085: the first definition of a key wins, and each later one is reported. */
function collectDefinitions(document: DocumentNode, walk: Walk, facts: ParseFacts | null): void {
  const abbreviations = new Map<string, AbbreviationDefNode>()
  const definitions = walk.resolution.definitions
  for (const child of document.children) {
    if (child.type === 'link_reference_definition') define(walk, definitions, child, 'duplicate-link-reference-definition', LINK_DUPLICATE)
    else if (child.type === 'footnote') define(walk, walk.footnotes, child, 'duplicate-footnote-definition', footnoteDuplicate(facts))
    else if (child.type === 'abbreviation_def') {
      define(walk, abbreviations, child, 'duplicate-abbreviation-definition', ABBREVIATION_DUPLICATE)
    }
  }
}

function headingId(heading: HeadingNode): string | undefined {
  return heading.attrs?.id ?? heading.generatedId
}

/**
 * C2-I-084: the folded plain text of each heading that can be a target; the first heading wins. The tree alone gives
 * it, so a tree resolves the same with and without its source.
 */
function headingIndex(walk: Walk, mode: HeadingIds): Map<string, HeadingNode> {
  const index = new Map<string, HeadingNode>()
  for (const heading of walk.headings) {
    if (mode === 'off' && heading.attrs?.id === undefined) continue
    const text = foldLabel(plainText(heading.children))
    if (!index.has(text)) index.set(text, heading)
  }
  return index
}

/** C2-I-084: the stored key read as inline content of its own, then its plain text, folded. */
function keyText(key: string): string {
  return foldLabel(plainText(inlineContent(key)))
}

/** What a reference resolves to: a definition, or a heading (C2-I-084). */
type Target = LinkReferenceDefinitionNode | HeadingNode

/** C2-A-109: the definition or the heading each reference resolves to. An image never resolves to a heading (C2-I-083). */
function findTargets(walk: Walk, mode: HeadingIds): Map<Reference, Target> {
  const targets = new Map<Reference, Target>()
  // The headings are indexed when the first reference finds no definition, which most documents never need.
  let headings: Map<string, HeadingNode> | null = null
  for (const reference of walk.references) {
    const key = reference.key
    if (key === undefined) continue
    const scope = walk.scopes.get(reference)
    let target: Target | undefined = scope === undefined ? walk.resolution.definitions.get(key) : lookUp(scope, key, (at) => at.definitions)
    if (scope !== undefined && target !== undefined) walk.resolution.definitionOf.set(reference, target)
    // C2-I-081, C2-A-213: a heading alone never forms a shortcut reference, so a supplied one stays unresolved.
    if (target === undefined && reference.type === 'link' && reference.refForm !== 'shortcut') {
      headings ??= headingIndex(walk, mode)
      target = headings.get(keyText(key))
    }
    if (target !== undefined) targets.set(reference, target)
  }
  return targets
}

function duplicateIdMessage(id: string): string {
  return `Duplicate id "${id}": the repeated HTML id is invalid, and cross-references to it resolve to the first occurrence.`
}

/**
 * C2-H-024: authored ids are reserved first, in document order, also that of an unresolved reference,
 * which writes its block as text (C2-I-085). C2-A-039: the first node of an id wins, whatever its type.
 */
function reserveIds(walk: Walk): Set<string> {
  const taken = new Set<string>()
  for (const node of walk.identified) {
    const id = node.attrs?.id
    if (id === undefined) continue
    if (taken.has(id)) report(walk.resolution, node, 'duplicate-id', duplicateIdMessage(id))
    else taken.add(id)
  }
  return taken
}

/** C2-H-022, C2-H-024: a slug that is taken gets the suffix `-2`, then `-3`, and so on. */
function generateIds(walk: Walk, mode: HeadingIds, taken: Set<string>): void {
  const suffixes = new Map<string, number>()
  for (const heading of walk.headings) {
    delete heading.generatedId
    if (mode === 'off' || heading.attrs?.id !== undefined) continue
    const slug = slugify(plainText(heading.children), mode)
    let id = slug
    let suffix = suffixes.get(slug) ?? 1
    while (taken.has(id)) id = `${slug}-${++suffix}`
    suffixes.set(slug, suffix)
    taken.add(id)
    heading.generatedId = id
  }
}

/**
 * C2-H-156: `adm-1`, `adm-2` and so on, in the order of the walk, which has the bodies of the notes
 * behind the document. A directive counts only when it places the footnote section.
 */
function generateLabelIds(walk: Walk, taken: Set<string>): void {
  const resolution = walk.resolution
  let count = 0
  for (const node of walk.titled) {
    if (node.type === 'directive' && (node !== walk.notesDirective || resolution.notes.length === 0)) continue
    const base = `adm-${++count}`
    let id = base
    for (let suffix = 2; taken.has(id); suffix++) id = `${base}-${suffix}`
    taken.add(id)
    resolution.labelIds.set(node, id)
  }
}

/** C2-A-107: sets or clears the destination of `reference`: `href` of a link, `src` of an image. */
function setDestination(reference: Reference, destination: string | undefined): void {
  if (reference.type === 'link') {
    if (destination === undefined) delete reference.href
    else reference.href = destination
  } else if (destination === undefined) {
    delete reference.src
  } else {
    reference.src = destination
  }
}

function setDestinations(walk: Walk, targets: Map<Reference, Target>, kept: Set<Reference>): void {
  for (const reference of walk.references) {
    const target = targets.get(reference)
    if (target === undefined) {
      // C2-A-107: an absent destination means unresolved.
      if (!kept.has(reference)) setDestination(reference, undefined)
    } else if (target.type === 'heading') {
      setDestination(reference, `#${headingId(target) ?? ''}`)
    } else {
      setDestination(reference, target.href)
    }
  }
}

/**
 * C2-B-208: the sequence key of a caption: the plain text of its label, which is what stands before
 * the mark, without trailing whitespace.
 */
function captionKey(walk: Walk, children: Inline[], mark: number): string {
  return trimEndWhitespace(captionLabelText(children.slice(0, mark), walk.symbols))
}

/** C2-H-149: the next number of the sequence of `key`. */
function nextNumber(sequences: Map<string, number>, key: string): number {
  const n = (sequences.get(key) ?? 0) + 1
  sequences.set(key, n)
  return n
}

/**
 * C2-H-149, C2-H-151: each caption with a mark and each numbered equation takes the next number of
 * the sequence of its key, in the order of the walk. A panel caption takes none (C2-H-066).
 */
function numberCaptions(walk: Walk, anchors: Map<string, string>): void {
  const sequences = new Map<string, number>()
  for (const use of walk.captions) {
    if (use.caption === null) {
      use.host.number = nextNumber(sequences, use.prefix)
      continue
    }
    const children = captionInlines(use.caption)
    const mark = children.findIndex((child) => child.type === 'caption_number')
    const number = children[mark]
    if (number?.type !== 'caption_number') continue
    if (use.panel) {
      delete number.n
      continue
    }
    const label = captionKey(walk, children, mark)
    const n = nextNumber(sequences, label)
    number.n = n
    // C2-N-072: the id of an include is no anchor.
    const id = use.host.type === 'include' ? undefined : use.host.attrs?.id
    if (id !== undefined && !anchors.has(id)) anchors.set(id, label === '' ? String(n) : `${label} ${n}`)
  }
}

/** C2-H-095, C2-H-096: a cross-reference resolves against the ids of headings and of numbered captions. */
function resolveXrefs(walk: Walk): void {
  const anchors = new Map<string, string>()
  // The text of a heading is read only where a cross-reference may point at it.
  for (const heading of walk.xrefs.length === 0 ? [] : walk.headings) {
    const id = headingId(heading)
    if (id !== undefined && !anchors.has(id)) anchors.set(id, plainText(heading.children))
  }
  numberCaptions(walk, anchors)
  for (const xref of walk.xrefs) {
    const text = anchors.get(xref.key)
    if (text === undefined) {
      delete xref.href
      continue
    }
    xref.href = `#${xref.key}`
    walk.resolution.xrefText.set(xref, text)
  }
}

/** The references whose destination an earlier resolution published and this one cannot look up again. */
function keptReferences(document: DocumentNode, walk: Walk, facts: ParseFacts | null): Set<Reference> {
  const kept = new Set<Reference>()
  if (facts !== null || document.stages?.includes('referenceResolution') !== true) return kept
  for (const reference of walk.references) {
    if ((reference.type === 'link' ? reference.href : reference.src) !== undefined) kept.add(reference)
  }
  return kept
}

/**
 * Resolves `document` in place. `facts` is what the parse knows of a tree it built from source;
 * without it a heading matches by its plain text alone (C2-I-084), and every node is walked.
 * `symbols` is the table of a render, which the key of a caption sequence reads (C2-B-208).
 */
export function resolve(
  document: DocumentNode, mode: HeadingIds, facts: ParseFacts | null, symbols: Readonly<Record<string, string>> = {},
): Resolution {
  const walk = newWalk(document, facts, symbols)
  const resolution = walk.resolution
  const top = walk.scope
  collectDefinitions(document, walk, facts)
  visit(walk, document, null)
  // C2-H-025: the content of the notes follows the document body, in the order of the footnote numbers.
  for (let at = 0; at < resolution.notes.length; at++) {
    const note = resolution.notes[at]!
    const body = note.definition ?? note.inline
    if (body === null) continue
    walk.scope = walk.scopes.get(body) ?? top
    for (const child of body.children) visit(walk, child, body)
  }
  visitUnwritten(walk, document.children, top)
  const kept = keptReferences(document, walk, facts)
  const targets = findTargets(walk, mode)
  const taken = reserveIds(walk)
  generateIds(walk, mode, taken)
  generateLabelIds(walk, taken)
  setDestinations(walk, targets, kept)
  resolveXrefs(walk)
  // C2-N-006: a tree in which expansion ran keeps it among its stages.
  document.stages = document.stages?.[0] === 'includeExpansion'
    ? ['includeExpansion', 'referenceResolution', 'tableAlignment'] : ['referenceResolution', 'tableAlignment']
  return resolution
}

/**
 * C2-A-109: a reference in a footnote definition that no reference uses, or that a duplicate lost to (C2-B-085), still
 * resolves, although the note is not written. Only its references are read: it takes no number and no id.
 */
function visitUnwritten(walk: Walk, children: readonly Node[], scope: Scope): void {
  for (const child of children) {
    if (child.type === 'include') visitUnwritten(walk, child.children ?? [], walk.scopes.get(child) ?? scope)
    if (child.type !== 'footnote' || walk.resolution.noteOf.has(child)) continue
    walk.scope = walk.scopes.get(child) ?? scope
    const pending: Node[] = [...child.children]
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
      if (node.type === 'link' || node.type === 'image') visitReference(node, walk)
      forEachSlot(node, (nodes) => { for (const below of nodes) pending.push(below) })
    }
  }
}

function newWalk(document: DocumentNode, facts: ParseFacts | null, symbols: Readonly<Record<string, string>>): Walk {
  const findings: Findings = { entries: [], nodes: [] }
  const resolution: Resolution = {
    definitions: new Map(), definitionOf: new Map(), notes: [], noteOf: new Map(), refIds: new Map(), xrefText: new Map(),
    labelIds: new Map(), findings, diagnostics: findings.entries, markupLines: new Map(),
  }
  const footnotes = new Map<string, FootnoteNode>()
  return {
    declarations: document.extensions ?? [], resolution, footnotes,
    scope: { outer: null, definitions: resolution.definitions, footnotes }, scopes: new Map(),
    headings: [], references: [], xrefs: [], captions: [], identified: [], titled: [],
    notesDirective: null, numberedFigures: 0, symbols, resolvableLeaves: facts?.resolvableLeaves ?? null, parent: null,
    markupLine: facts?.markupLine ?? null,
  }
}

/** C2-N-027: the id of each heading of a file as its own parse gives it, before it meets the ids of another file. */
export function headingIdsAlone(document: DocumentNode, mode: HeadingIds): Map<Node, string> {
  const walk = newWalk(document, null, {})
  visit(walk, document, null)
  generateIds(walk, mode, reserveIds(walk))
  const ids = new Map<Node, string>()
  for (const heading of walk.headings) {
    const id = headingId(heading)
    if (id !== undefined) ids.set(heading, id)
  }
  return ids
}
