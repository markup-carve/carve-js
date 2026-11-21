import { type Visit } from './context.ts'
import { type Node01 } from './engines.ts'

/** Node types that hold blocks. Every other node under one of them is a leaf block. */
const CONTAINERS = new Set([
  'document', 'list', 'list_item', 'block_quote', 'div', 'admonition', 'directive', 'definition_list', 'figure_group', 'figure',
])

/** Which leaf block holds each line. A line no leaf holds is a gap line: blank, an attribute line, a `+`. */
export interface BlockMap {
  /** Indexed by line, from 1. */
  leaf: (Visit | null)[]
  /** The leaf blocks in document order. */
  leaves: Visit[]
  /**
   * For a line strictly inside a block of the document, the last line of that block, else 0. A
   * definition on such a line stands in the middle of the block: between the lines of a paragraph,
   * which 0.1 reads on across it, or between two items of a list.
   */
  within: number[]
}

const DEFINITIONS = new Set(['link_reference_definition', 'abbreviation_def'])

function blockEnds(doc: Node01, lineCount: number): number[] {
  const ends = new Array<number>(lineCount + 2).fill(0)
  for (const child of doc.children ?? []) {
    if (child.pos === undefined || DEFINITIONS.has(child.type)) continue
    for (let line = child.pos.startLine + 1; line < child.pos.endLine && line <= lineCount; line++) ends[line] = child.pos.endLine
  }
  return ends
}

export function isContainer(node: Node01): boolean {
  return CONTAINERS.has(node.type)
}

export function mapBlocks(visits: Visit[], lineCount: number): BlockMap {
  const leaf = new Array<Visit | null>(lineCount + 2).fill(null)
  const leaves: Visit[] = []
  for (const visit of visits) {
    const pos = visit.node.pos
    if (pos === undefined || visit.parent === null || isContainer(visit.node) || !isContainer(visit.parent.node)) continue
    leaves.push(visit)
    for (let line = pos.startLine; line <= pos.endLine && line <= lineCount; line++) leaf[line] ??= visit
  }
  return { leaf, leaves, within: blockEnds(visits[0]!.node, lineCount) }
}

/** The nearest ancestor of `visit` of the type `type`, or null. */
export function ancestor(visit: Visit, type: string): Visit | null {
  for (let at = visit.parent; at !== null; at = at.parent) {
    if (at.node.type === type) return at
  }
  return null
}

export function isInside(visit: Visit, outer: Visit): boolean {
  for (let at: Visit | null = visit; at !== null; at = at.parent) {
    if (at === outer) return true
  }
  return false
}

/** The quotes written with `>` marks that hold `visit`, innermost first. */
export function quotesOf(visit: Visit): Visit[] {
  const quotes: Visit[] = []
  for (let at = visit.parent; at !== null; at = at.parent) {
    if (at.node.type === 'block_quote' && at.node.fenced !== true) quotes.push(at)
  }
  return quotes
}
