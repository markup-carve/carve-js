// Resolution (C2-A-103 to C2-A-117, C2-A-133 to C2-A-135): references against definitions and
// headings, footnote numbers, heading ids, caption numbers, cross-references and column alignment.
// The results are written into the tree beside the authored constructs; what a renderer needs
// besides them is returned.
import { type AstNode } from './ast.ts'
import { type ParseFacts } from './ast-blocks.ts'
import { labelText, plainText } from './ast-text.ts'
import { addFinding, type Diagnostic, type Findings } from './diagnostics.ts'
import { type HeadingIds } from './options.ts'
import { slugify } from './slug.ts'

export { type Diagnostic } from './diagnostics.ts'

/** One numbered footnote: a definition that a reference uses, or an inline footnote. */
export interface Note {
  number: number
  definition: AstNode | null
  inline: AstNode | null
  /** The ids of its references in the order of the document, for the backlinks (C2-H-091). */
  refIds: string[]
}

export interface Resolution {
  definitions: Map<string, AstNode>
  notes: Note[]
  noteOf: Map<AstNode, Note>
  refIds: Map<AstNode, string>
  /** The generated text of each resolved cross-reference (C2-H-096). */
  xrefText: Map<AstNode, string>
  /** C2-H-156: the generated id of the title of each admonition and of the directive that places the notes. */
  labelIds: Map<AstNode, string>
  /** The findings of resolution, each with its node. `diagnostics` is the list of its entries. */
  findings: Findings
  diagnostics: Diagnostic[]
}

/** One taker of a sequence number: a caption with its host, or a numbered equation of a supplied tree (C2-H-151). */
interface CaptionUse {
  caption: AstNode | null
  host: AstNode
  panel: boolean
}

interface Walk {
  resolution: Resolution
  footnotes: Map<string, AstNode>
  headings: AstNode[]
  references: AstNode[]
  xrefs: AstNode[]
  captions: CaptionUse[]
  identified: AstNode[]
  /** C2-H-156: the titled admonitions and the titled top-level `footnotes` directives, in the order of the walk. */
  titled: AstNode[]
  /** C2-H-093: the first top-level `footnotes` directive. */
  notesDirective: AstNode | null
  /** C2-H-151: the figures and figure groups around the node that is visited whose caption has a number mark. */
  numberedFigures: number
  symbols: Readonly<Record<string, string>>
  /** The leaves of a parsed tree that the walk goes into, or null for a tree of which nothing is known. */
  resolvableLeaves: ReadonlySet<AstNode> | null
}

type Visitor = (walk: Walk, node: AstNode, parent: AstNode | null) => void

/** C2-W-113: a duplicate is a finding of the parse channel, reported on the later node. */
function report(resolution: Resolution, node: AstNode, code: string, message: string): void {
  addFinding(resolution.findings, node, { code, severity: 'warning', channel: 'parse', message })
}

/** C2-H-087, C2-H-088: the note of a reference takes the next number at its first reference. */
function useNote(walk: Walk, node: AstNode, definition: AstNode | null): void {
  const resolution = walk.resolution
  let note = definition === null ? undefined : resolution.noteOf.get(definition)
  if (note === undefined) {
    note = { number: resolution.notes.length + 1, definition, inline: definition === null ? node : null, refIds: [] }
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

function visitFootnoteRef(walk: Walk, node: AstNode): void {
  const definition = walk.footnotes.get(node.key ?? '')
  if (definition === undefined) delete node.number
  else useNote(walk, node, definition)
}

function visitHost(walk: Walk, node: AstNode, parent: AstNode | null): void {
  if (node.type === 'table') alignColumns(node)
  if (node.caption !== undefined) walk.captions.push({ caption: node.caption, host: node, panel: parent?.type === 'figure_group' })
}

/** C2-H-151: a display equation with a prefix takes a number, unless the caption of a figure around it owns the number. */
function visitMath(walk: Walk, node: AstNode): void {
  delete node.number
  if (node.display === true && node.numberPrefix !== undefined && walk.numberedFigures === 0) {
    walk.captions.push({ caption: null, host: node, panel: false })
  }
}

function captionInlines(caption: AstNode): AstNode[] {
  return caption.children?.[0]?.children ?? []
}

/** True for a figure or a figure group whose caption has a number mark. */
function ownsNumber(node: AstNode): boolean {
  if (node.caption === undefined || (node.type !== 'figure' && node.type !== 'figure_group')) return false
  return captionInlines(node.caption).some((child) => child.type === 'caption_number')
}

const NAMING_KEYS = ['aria-label', 'aria-labelledby']

/** C2-H-155: true when the attribute line names the node itself, so the renderer generates no name and no id. */
export function hasAuthoredName(node: AstNode): boolean {
  return (node.attrs?.keyValues ?? []).some(([key]) => NAMING_KEYS.includes(key.toLowerCase()))
}

function visitAdmonition(walk: Walk, node: AstNode): void {
  if (Array.isArray(node.title) && !hasAuthoredName(node)) walk.titled.push(node)
}

function visitDirective(walk: Walk, node: AstNode, parent: AstNode | null): void {
  if (node.kind !== 'footnotes' || parent?.type !== 'document') return
  walk.notesDirective ??= node
  if (Array.isArray(node.title)) walk.titled.push(node)
}

function visitReference(walk: Walk, node: AstNode): void {
  if (node.key !== undefined) walk.references.push(node)
}

// What the walk does at a node of a type, besides going into its children. A type with no entry has nothing.
const LEAF = 1
const OPAQUE = 2
const SLOTS = 4

interface Step {
  visitor: Visitor | null
  /** LEAF: inline content that a parse may know to hold nothing. OPAQUE: a note, whose content is walked with the notes. SLOTS: a title or a caption. */
  traits: number
}

const STEPS = new Map<string, Step>([
  ['footnote_ref', { visitor: visitFootnoteRef, traits: 0 }],
  ['inline_footnote', { visitor: (walk, node) => useNote(walk, node, null), traits: OPAQUE }],
  ['footnote', { visitor: null, traits: OPAQUE }],
  ['heading', { visitor: (walk, node) => void walk.headings.push(node), traits: LEAF }],
  ['paragraph', { visitor: null, traits: LEAF }],
  ['definition_term', { visitor: null, traits: LEAF }],
  ['cell_paragraph', { visitor: null, traits: LEAF }],
  ['line', { visitor: null, traits: LEAF }],
  ['link', { visitor: visitReference, traits: 0 }],
  ['image', { visitor: visitReference, traits: 0 }],
  ['xref', { visitor: (walk, node) => void walk.xrefs.push(node), traits: 0 }],
  ['figure', { visitor: visitHost, traits: SLOTS }],
  ['figure_group', { visitor: visitHost, traits: SLOTS }],
  ['table', { visitor: visitHost, traits: SLOTS }],
  ['math', { visitor: visitMath, traits: 0 }],
  ['admonition', { visitor: visitAdmonition, traits: SLOTS }],
  ['directive', { visitor: visitDirective, traits: SLOTS }],
  ['div', { visitor: null, traits: SLOTS }],
])

/** Visits the children of `node`. Text is skipped here and not in the call: half of the nodes of a document are text. */
function visitChildren(walk: Walk, node: AstNode): void {
  const children = node.children
  if (children === undefined) return
  for (const child of children) if (child.type !== 'text') visit(walk, child, node)
}

/** The title, the children and the caption of a node that may carry a title or a caption, in that order (C2-A-025). */
function visitSlots(walk: Walk, node: AstNode): void {
  if (Array.isArray(node.title)) for (const child of node.title) visit(walk, child, node)
  const owns = node.caption !== undefined && ownsNumber(node)
  if (owns) walk.numberedFigures++
  visitChildren(walk, node)
  if (owns) walk.numberedFigures--
  if (node.caption !== undefined) visit(walk, node.caption, node)
}

/**
 * Visits `node` and the nodes below it in document order. A note is visited with the notes, not
 * where it stands, and a leaf of a parsed tree is entered only where the parse saw a node that
 * resolution reads.
 */
function visit(walk: Walk, node: AstNode, parent: AstNode | null): void {
  const step = STEPS.get(node.type)
  if (node.attrs?.id !== undefined) walk.identified.push(node)
  if (step === undefined) return visitChildren(walk, node)
  step.visitor?.(walk, node, parent)
  const traits = step.traits
  if (traits === SLOTS) visitSlots(walk, node)
  else if (traits === 0 || (traits === LEAF && (walk.resolvableLeaves === null || walk.resolvableLeaves.has(node)))) visitChildren(walk, node)
}

/** The marks of one head row, each at the column its cell starts in (C2-A-092, C2-A-093). `covered` counts the rows a cell above still spans. */
function rowMarks(row: AstNode, field: 'align' | 'valign', covered: number[], marks: (string | undefined)[]): void {
  const cells = row.children ?? []
  const marked = cells.some((cell) => cell.span !== undefined)
  let column = 0
  for (const cell of cells) {
    while (!marked && (covered[column] ?? 0) > 0) covered[column++]!--
    if (cell[field] !== undefined) marks[column] = cell[field]
    if (!marked) for (let more = 0; more < (cell.colspan ?? 1); more++) covered[column + more] = (cell.rowspan ?? 1) - 1
    column += marked ? 1 : cell.colspan ?? 1
  }
}

/**
 * C2-B-213: the mark each column takes from the head, on one axis: that of the last head cell
 * that starts in the column and has one. A cell that spans several columns marks only the first.
 */
export function headMarks(table: AstNode, field: 'align' | 'valign'): (string | undefined)[] {
  const marks: (string | undefined)[] = []
  for (const group of table.children ?? []) {
    if (group.type !== 'table_head') continue
    const covered: number[] = []
    for (const row of group.children ?? []) if (row.type === 'table_row') rowMarks(row, field, covered, marks)
  }
  return marks
}

/** C2-B-213: the resolved alignment of a column is the mark of its head cell, or else what `aligns` spelled. */
function alignColumns(table: AstNode): void {
  const columns = table.columns ?? []
  if (columns.length === 0) return
  const fromHead = headMarks(table, 'align')
  columns.forEach((column, at) => {
    const align = fromHead[at] ?? column.align
    if (align === undefined) delete column.resolvedAlign
    else column.resolvedAlign = align
  })
}

/** C2-B-085: the first definition of a key wins, and each later one is reported. */
function collectDefinitions(document: AstNode, walk: Walk): void {
  const tables: [string, Map<string, AstNode>, string][] = [
    ['link_reference_definition', walk.resolution.definitions, 'duplicate-link-reference-definition'],
    ['footnote', walk.footnotes, 'duplicate-footnote-definition'],
    ['abbreviation_def', new Map<string, AstNode>(), 'duplicate-abbreviation-definition'],
  ]
  for (const child of document.children ?? []) {
    for (const [type, table, code] of tables) {
      if (child.type !== type) continue
      const key = child.key ?? ''
      if (table.has(key)) report(walk.resolution, child, code, `${key} is defined more than once`)
      else table.set(key, child)
    }
  }
}

function headingId(heading: AstNode): string | undefined {
  return heading.attrs?.id ?? heading.generatedId
}

/** C2-I-084: the folded source and the plain text of each heading that can be a target; the first heading wins. */
function headingIndex(walk: Walk, mode: HeadingIds, facts: ParseFacts | null): Map<string, AstNode> {
  const index = new Map<string, AstNode>()
  for (const heading of walk.headings) {
    if (mode === 'off' && heading.attrs?.id === undefined) continue
    const source = facts?.headingSource(heading)
    if (source !== undefined && !index.has(source)) index.set(source, heading)
    const text = plainText(heading.children ?? [])
    if (!index.has(text)) index.set(text, heading)
  }
  return index
}

/** C2-A-109: the definition or the heading each reference resolves to. An image never resolves to a heading (C2-I-083). */
function findTargets(walk: Walk, mode: HeadingIds, facts: ParseFacts | null): Map<AstNode, AstNode> {
  const targets = new Map<AstNode, AstNode>()
  // The headings are indexed when the first reference finds no definition, which most documents never need.
  let headings: Map<string, AstNode> | null = null
  for (const reference of walk.references) {
    const key = reference.key!
    let target = walk.resolution.definitions.get(key)
    if (target === undefined && reference.type === 'link') {
      headings ??= headingIndex(walk, mode, facts)
      target = headings.get(key)
    }
    if (target !== undefined) targets.set(reference, target)
  }
  return targets
}

/** C2-H-024: authored ids are reserved first, in document order. C2-A-039: the first node of an id wins. */
function reserveIds(walk: Walk, targets: Map<AstNode, AstNode>, kept: Set<AstNode>): Set<string> {
  const taken = new Set<string>()
  for (const node of walk.identified) {
    // An unresolved reference renders its attribute block as text, so its id is no id of the document.
    if (node.key !== undefined && (node.type === 'link' || node.type === 'image') && !targets.has(node) && !kept.has(node)) continue
    const id = node.attrs!.id!
    if (taken.has(id)) report(walk.resolution, node, 'duplicate-id', `the id ${id} is used more than once`)
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
    const slug = slugify(plainText(heading.children ?? []), mode)
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

function setDestinations(walk: Walk, targets: Map<AstNode, AstNode>, kept: Set<AstNode>): void {
  for (const reference of walk.references) {
    const field = reference.type === 'link' ? 'href' : 'src'
    const target = targets.get(reference)
    if (target === undefined) {
      // C2-A-107: an absent destination means unresolved.
      if (!kept.has(reference)) delete reference[field]
    } else if (target.type === 'heading') {
      reference.href = `#${headingId(target)!}`
    } else {
      reference[field] = target.href ?? ''
    }
  }
}

/** C2-B-208: the sequence key of a caption: the plain text of its label, which is what stands before the mark, without trailing whitespace. */
function captionKey(walk: Walk, children: AstNode[], mark: number): string {
  return labelText(children.slice(0, mark), walk.symbols).trimEnd()
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
      use.host.number = nextNumber(sequences, use.host.numberPrefix!)
      continue
    }
    const children = captionInlines(use.caption)
    const mark = children.findIndex((child) => child.type === 'caption_number')
    if (mark < 0) continue
    const number = children[mark]!
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
    if (id !== undefined && !anchors.has(id)) anchors.set(id, plainText(heading.children ?? []))
  }
  numberCaptions(walk, anchors)
  for (const xref of walk.xrefs) {
    const text = anchors.get(xref.key ?? '')
    if (text === undefined) {
      delete xref.href
      continue
    }
    xref.href = `#${xref.key!}`
    walk.resolution.xrefText.set(xref, text)
  }
}

/** The references whose destination an earlier resolution published and this one cannot look up again. */
function keptReferences(document: AstNode, walk: Walk, facts: ParseFacts | null): Set<AstNode> {
  const kept = new Set<AstNode>()
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
  document: AstNode, mode: HeadingIds, facts: ParseFacts | null, symbols: Readonly<Record<string, string>> = {},
): Resolution {
  const findings: Findings = { entries: [], nodes: [] }
  const resolution: Resolution = {
    definitions: new Map(), notes: [], noteOf: new Map(), refIds: new Map(), xrefText: new Map(), labelIds: new Map(),
    findings, diagnostics: findings.entries,
  }
  const walk: Walk = {
    resolution, footnotes: new Map(), headings: [], references: [], xrefs: [], captions: [], identified: [], titled: [],
    notesDirective: null, numberedFigures: 0, symbols, resolvableLeaves: facts?.resolvableLeaves ?? null,
  }
  collectDefinitions(document, walk)
  visit(walk, document, null)
  // C2-H-025: the content of the notes follows the document body, in the order of the footnote numbers.
  for (let at = 0; at < resolution.notes.length; at++) {
    const note = resolution.notes[at]!
    const body = note.definition ?? note.inline!
    for (const child of body.children ?? []) visit(walk, child, body)
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
