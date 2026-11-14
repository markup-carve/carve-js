// Resolution (C2-A-103 to C2-A-117, C2-A-133 to C2-A-135): references against definitions and
// headings, footnote numbers, heading ids, caption numbers, cross-references and column alignment.
// The results are written into the tree beside the authored constructs; what a renderer needs
// besides them is returned.
import {
  type AbbreviationDefNode, type AdmonitionNode, type CaptionNode, type DirectiveNode, type DivNode,
  type DocumentNode, type FigureGroupNode, type FigureNode, type FootnoteNode, type FootnoteRefNode, handle,
  type HeadingNode, type ImageNode, type Inline, type InlineFootnoteNode, type LinkNode,
  type LinkReferenceDefinitionNode, type MathNode, type Node, type NodeHandlers, type TableCellNode, type TableNode,
  type TableRowNode, type XrefNode,
} from './ast.ts'
import { type ParseFacts } from './ast-blocks.ts'
import { captionLabelText, plainText } from './ast-text.ts'
import { addFinding, type Diagnostic, type Findings } from './diagnostics.ts'
import { type HeadingIds } from './options.ts'
import { slugify } from './slug.ts'

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
}

/** One taker of a sequence number: a caption with its host, or a numbered equation of a supplied tree (C2-H-151). */
type CaptionUse =
  | { caption: CaptionNode, host: FigureNode | FigureGroupNode | TableNode, panel: boolean }
  | { caption: null, host: MathNode, prefix: string }

/** A link or an image written as a reference (C2-A-105). */
type Reference = LinkNode | ImageNode

interface Walk {
  resolution: Resolution
  footnotes: Map<string, FootnoteNode>
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

function visitFootnoteRef(node: FootnoteRefNode, walk: Walk): boolean {
  const definition = walk.footnotes.get(node.key)
  if (definition === undefined) delete node.number
  else useNote(walk, node, definition)
  return true
}

function visitHost(node: FigureNode | FigureGroupNode | TableNode, walk: Walk): boolean {
  const panel = walk.parent?.type === 'figure_group'
  if (node.type === 'table') alignColumns(node)
  if (node.caption !== undefined) walk.captions.push({ caption: node.caption, host: node, panel })
  visitSlots(walk, node)
  return true
}

/** C2-H-151: a display equation with a prefix takes a number, unless the caption of a figure around it owns the number. */
function visitMath(node: MathNode, walk: Walk): boolean {
  delete node.number
  if (node.display && node.numberPrefix !== undefined && walk.numberedFigures === 0) {
    walk.captions.push({ caption: null, host: node, prefix: node.numberPrefix })
  }
  return true
}

/** The inline content of the paragraph of a caption (C2-A-081), or none. */
function captionInlines(caption: CaptionNode): Inline[] {
  const first = caption.children[0]
  return first?.type === 'paragraph' || first?.type === 'heading' ? first.children : []
}

/** True for a figure or a figure group whose caption, `caption`, has a number mark. A table owns no number of an equation. */
function ownsNumber(node: Node, caption: CaptionNode): boolean {
  if (node.type !== 'figure' && node.type !== 'figure_group') return false
  return captionInlines(caption).some((child) => child.type === 'caption_number')
}

const NAMING_KEYS = ['aria-label', 'aria-labelledby']

/** C2-H-155: true when the attribute line names the node itself, so the renderer generates no name and no id. */
export function hasAuthoredName(node: Node): boolean {
  return node.attrs?.keyValues?.some(([key]) => NAMING_KEYS.includes(key.toLowerCase())) === true
}

function visitAdmonition(node: AdmonitionNode, walk: Walk): boolean {
  if (node.title !== undefined && !hasAuthoredName(node)) walk.titled.push(node)
  visitSlots(walk, node)
  return true
}

function visitDirective(node: DirectiveNode, walk: Walk): boolean {
  if (node.kind === 'footnotes' && walk.parent?.type === 'document') {
    walk.notesDirective ??= node
    if (node.title !== undefined) walk.titled.push(node)
  }
  visitSlots(walk, node)
  return true
}

function visitReference(node: Reference, walk: Walk): boolean {
  if (node.key !== undefined) walk.references.push(node)
  visitChildren(walk, node)
  return true
}

/** A leaf with inline content, which a parse may know to hold nothing that resolution reads. */
function visitLeaf(node: Node, walk: Walk): boolean {
  if (mayResolve(walk, node)) visitChildren(walk, node)
  return true
}

/**
 * What the walk does at a node of a type. A type with no entry has its children visited. A note
 * is opaque: its content is visited with the notes. A title and a caption are visited with the children.
 */
const VISITS: NodeHandlers<boolean, Walk> = {
  footnote_ref: visitFootnoteRef,
  inline_footnote: (node, walk) => {
    useNote(walk, node, null)
    return true
  },
  footnote: () => true,
  heading: (node, walk) => {
    walk.headings.push(node)
    return visitLeaf(node, walk)
  },
  paragraph: visitLeaf,
  definition_term: visitLeaf,
  cell_paragraph: visitLeaf,
  line: visitLeaf,
  link: visitReference,
  image: visitReference,
  xref: (node, walk) => {
    walk.xrefs.push(node)
    return true
  },
  figure: visitHost,
  figure_group: visitHost,
  table: visitHost,
  math: visitMath,
  admonition: visitAdmonition,
  directive: visitDirective,
  div: (node, walk) => {
    visitSlots(walk, node)
    return true
  },
}

/** Visits the children of `node`. Text is skipped here and not in the call: half of the nodes of a document are text. */
function visitChildren(walk: Walk, node: Node): void {
  if (!('children' in node)) return
  for (const child of node.children) if (child.type !== 'text') visit(walk, child, node)
}

/** The title, the children and the caption of a node that may carry a title or a caption, in that order (C2-A-025). */
function visitSlots(walk: Walk, node: FigureNode | FigureGroupNode | TableNode | AdmonitionNode | DirectiveNode | DivNode): void {
  if ('title' in node && node.title !== undefined) for (const child of node.title) visit(walk, child, node)
  const caption = 'caption' in node ? node.caption : undefined
  const owns = caption !== undefined && ownsNumber(node, caption)
  if (owns) walk.numberedFigures++
  visitChildren(walk, node)
  if (owns) walk.numberedFigures--
  if (caption !== undefined) visit(walk, caption, node)
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
  if (node.attrs?.id !== undefined) walk.identified.push(node)
  walk.parent = parent
  if (handle(VISITS, node.type, node, walk) === undefined) visitChildren(walk, node)
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

/** C2-I-084: the folded source and the plain text of each heading that can be a target; the first heading wins. */
function headingIndex(walk: Walk, mode: HeadingIds, facts: ParseFacts | null): Map<string, HeadingNode> {
  const index = new Map<string, HeadingNode>()
  for (const heading of walk.headings) {
    if (mode === 'off' && heading.attrs?.id === undefined) continue
    const source = facts?.headingSource(heading)
    if (source !== undefined && !index.has(source)) index.set(source, heading)
    const text = plainText(heading.children)
    if (!index.has(text)) index.set(text, heading)
  }
  return index
}

/** What a reference resolves to: a definition, or a heading (C2-I-084). */
type Target = LinkReferenceDefinitionNode | HeadingNode

/** C2-A-109: the definition or the heading each reference resolves to. An image never resolves to a heading (C2-I-083). */
function findTargets(walk: Walk, mode: HeadingIds, facts: ParseFacts | null): Map<Reference, Target> {
  const targets = new Map<Reference, Target>()
  // The headings are indexed when the first reference finds no definition, which most documents never need.
  let headings: Map<string, HeadingNode> | null = null
  for (const reference of walk.references) {
    const key = reference.key
    if (key === undefined) continue
    let target: Target | undefined = walk.resolution.definitions.get(key)
    if (target === undefined && reference.type === 'link') {
      headings ??= headingIndex(walk, mode, facts)
      target = headings.get(key)
    }
    if (target !== undefined) targets.set(reference, target)
  }
  return targets
}

/** An unresolved reference renders its attribute block as text, so its id is no id of the document. */
function isUnresolvedReference(node: Node, targets: Map<Reference, Target>, kept: Set<Reference>): boolean {
  return (node.type === 'link' || node.type === 'image') && node.key !== undefined && !targets.has(node) && !kept.has(node)
}

function duplicateIdMessage(id: string): string {
  return `Duplicate id "${id}": the repeated HTML id is invalid, and cross-references to it resolve to the first occurrence.`
}

/** C2-H-024: authored ids are reserved first, in document order. C2-A-039: the first node of an id wins. */
function reserveIds(walk: Walk, targets: Map<Reference, Target>, kept: Set<Reference>): Set<string> {
  const taken = new Set<string>()
  for (const node of walk.identified) {
    const id = node.attrs?.id
    if (id === undefined || isUnresolvedReference(node, targets, kept)) continue
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
  return captionLabelText(children.slice(0, mark), walk.symbols).trimEnd()
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
    const id = use.host.attrs?.id
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
  const findings: Findings = { entries: [], nodes: [] }
  const resolution: Resolution = {
    definitions: new Map(), notes: [], noteOf: new Map(), refIds: new Map(), xrefText: new Map(), labelIds: new Map(),
    findings, diagnostics: findings.entries,
  }
  const walk: Walk = {
    resolution, footnotes: new Map(), headings: [], references: [], xrefs: [], captions: [], identified: [], titled: [],
    notesDirective: null, numberedFigures: 0, symbols, resolvableLeaves: facts?.resolvableLeaves ?? null, parent: null,
  }
  collectDefinitions(document, walk, facts)
  visit(walk, document, null)
  // C2-H-025: the content of the notes follows the document body, in the order of the footnote numbers.
  for (let at = 0; at < resolution.notes.length; at++) {
    const note = resolution.notes[at]!
    const body = note.definition ?? note.inline
    if (body !== null) for (const child of body.children) visit(walk, child, body)
  }
  const kept = keptReferences(document, walk, facts)
  const targets = findTargets(walk, mode, facts)
  const taken = reserveIds(walk, targets, kept)
  generateIds(walk, mode, taken)
  generateLabelIds(walk, taken)
  setDestinations(walk, targets, kept)
  resolveXrefs(walk)
  document.stages = ['referenceResolution', 'tableAlignment']
  return resolution
}
