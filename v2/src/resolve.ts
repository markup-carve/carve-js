// Resolution (C2-A-103 to C2-A-117, C2-A-133 to C2-A-135): references against definitions and
// headings, footnote numbers, heading ids, caption numbers, cross-references and column alignment.
// The results are written into the tree beside the authored constructs; what a renderer needs
// besides them is returned.
import { type AstNode } from './ast.ts'
import { plainText } from './ast-text.ts'
import { type HeadingIds } from './options.ts'
import { slugify } from './slug.ts'

/** C2-A-173: one entry of the diagnostics record. `path` is an RFC 6901 pointer into the tree. */
export interface Diagnostic {
  code: string
  severity: 'error' | 'warning'
  channel: 'parse' | 'render-loss' | 'lint'
  message: string
  path?: string
}

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
  diagnostics: Diagnostic[]
}

interface CaptionUse {
  caption: AstNode
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
}

type Visitor = (walk: Walk, node: AstNode, parent: AstNode | null) => void

function report(resolution: Resolution, code: string, message: string): void {
  resolution.diagnostics.push({ code, severity: 'warning', channel: 'lint', message })
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

function visitReference(walk: Walk, node: AstNode): void {
  if (node.key !== undefined) walk.references.push(node)
}

const VISITORS = new Map<string, Visitor>([
  ['footnote_ref', visitFootnoteRef],
  ['inline_footnote', (walk, node) => useNote(walk, node, null)],
  ['heading', (walk, node) => void walk.headings.push(node)],
  ['link', visitReference],
  ['image', visitReference],
  ['xref', (walk, node) => void walk.xrefs.push(node)],
  ['figure', visitHost],
  ['figure_group', visitHost],
  ['table', visitHost],
])

/**
 * Visits `node` and the nodes below it in document order: the title, the children, the caption
 * (C2-A-025). A note is visited with the notes, not where it stands.
 */
function visit(walk: Walk, node: AstNode, parent: AstNode | null): void {
  // Most nodes are text, which resolution does not read.
  if (node.type === 'text') return
  VISITORS.get(node.type)?.(walk, node, parent)
  if (node.attrs?.id !== undefined) walk.identified.push(node)
  if (node.type === 'inline_footnote' || node.type === 'footnote') return
  if (Array.isArray(node.title)) for (const child of node.title) visit(walk, child, node)
  if (node.children !== undefined) for (const child of node.children) visit(walk, child, node)
  if (node.caption !== undefined) visit(walk, node.caption, node)
}

/** C2-A-089: the alignment of a column is the one its source spelled, or that of its last head cell that has one. */
function alignColumns(table: AstNode): void {
  const columns = table.columns ?? []
  const fromHead: (string | undefined)[] = []
  for (const group of table.children ?? []) {
    if (group.type !== 'table_head') continue
    for (const row of group.children ?? []) {
      (row.children ?? []).forEach((cell, column) => {
        if (cell.align !== undefined) fromHead[column] = cell.align
      })
    }
  }
  columns.forEach((column, at) => {
    const align = column.align ?? fromHead[at]
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
      if (table.has(key)) report(walk.resolution, code, `${key} is defined more than once`)
      else table.set(key, child)
    }
  }
}

function headingId(heading: AstNode): string | undefined {
  return heading.attrs?.id ?? heading.generatedId
}

/** C2-I-084: the folded source and the plain text of each heading that can be a target; the first heading wins. */
function headingIndex(walk: Walk, mode: HeadingIds, sources: Map<AstNode, string> | null): Map<string, AstNode> {
  const index = new Map<string, AstNode>()
  for (const heading of walk.headings) {
    if (mode === 'off' && heading.attrs?.id === undefined) continue
    const source = sources?.get(heading)
    if (source !== undefined && !index.has(source)) index.set(source, heading)
    const text = plainText(heading.children ?? [])
    if (!index.has(text)) index.set(text, heading)
  }
  return index
}

/** C2-A-109: the definition or the heading each reference resolves to. An image never resolves to a heading (C2-I-083). */
function findTargets(walk: Walk, headings: Map<string, AstNode>): Map<AstNode, AstNode> {
  const targets = new Map<AstNode, AstNode>()
  for (const reference of walk.references) {
    const key = reference.key!
    const target = walk.resolution.definitions.get(key) ?? (reference.type === 'link' ? headings.get(key) : undefined)
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
    if (taken.has(id)) report(walk.resolution, 'duplicate-id', `the id ${id} is used more than once`)
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

/** The label of a caption: the plain text before its number mark, without trailing whitespace (C2-B-150). */
function captionLabel(children: AstNode[], mark: number): string {
  return plainText(children.slice(0, mark)).trimEnd()
}

/** C2-H-066: each caption takes the next number of the sequence its label selects. A panel caption takes none. */
function numberCaptions(walk: Walk, anchors: Map<string, string>): void {
  const sequences = new Map<string, number>()
  for (const use of walk.captions) {
    const children = use.caption.children?.[0]?.children ?? []
    const mark = children.findIndex((child) => child.type === 'caption_number')
    if (mark < 0) continue
    const number = children[mark]!
    if (use.panel) {
      delete number.n
      continue
    }
    const label = captionLabel(children, mark)
    const n = (sequences.get(label) ?? 0) + 1
    sequences.set(label, n)
    number.n = n
    const id = use.host.attrs?.id
    if (id !== undefined && !anchors.has(id)) anchors.set(id, label === '' ? String(n) : `${label} ${n}`)
  }
}

/** C2-H-095, C2-H-096: a cross-reference resolves against the ids of headings and of numbered captions. */
function resolveXrefs(walk: Walk): void {
  const anchors = new Map<string, string>()
  for (const heading of walk.headings) {
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
function keptReferences(document: AstNode, walk: Walk, sources: Map<AstNode, string> | null): Set<AstNode> {
  const kept = new Set<AstNode>()
  if (sources !== null || document.stages?.includes('referenceResolution') !== true) return kept
  for (const reference of walk.references) {
    if ((reference.type === 'link' ? reference.href : reference.src) !== undefined) kept.add(reference)
  }
  return kept
}

/**
 * Resolves `document` in place. `sources` holds the folded source of each heading of a tree that
 * was parsed from source; without it a heading matches by its plain text alone (C2-I-084).
 */
export function resolve(document: AstNode, mode: HeadingIds, sources: Map<AstNode, string> | null): Resolution {
  const resolution: Resolution = {
    definitions: new Map(), notes: [], noteOf: new Map(), refIds: new Map(), xrefText: new Map(), diagnostics: [],
  }
  const walk: Walk = { resolution, footnotes: new Map(), headings: [], references: [], xrefs: [], captions: [], identified: [] }
  collectDefinitions(document, walk)
  visit(walk, document, null)
  // C2-H-025: the content of the notes follows the document body, in the order of the footnote numbers.
  for (let at = 0; at < resolution.notes.length; at++) {
    const note = resolution.notes[at]!
    const body = note.definition ?? note.inline!
    for (const child of body.children ?? []) visit(walk, child, body)
  }
  const kept = keptReferences(document, walk, sources)
  const targets = findTargets(walk, headingIndex(walk, mode, sources))
  generateIds(walk, mode, reserveIds(walk, targets, kept))
  setDestinations(walk, targets, kept)
  resolveXrefs(walk)
  document.stages = ['referenceResolution', 'tableAlignment']
  return resolution
}
