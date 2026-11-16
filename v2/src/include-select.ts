// The section of an included file (C2-N-027 to C2-N-033) and the heading shifts of an expanded tree (C2-N-048 to C2-N-051).
import {
  DEFINITION_TYPES, type DocumentNode, forEachSlot, type HeadingNode, type IncludeNode, isBlockParent, type Node,
} from './ast.ts'
import { type ParseFacts, type ParsedTree } from './ast-blocks.ts'
import { plainText } from './ast-text.ts'
import { addFinding, type Findings } from './diagnostics.ts'
import { type Selected } from './expand.ts'
import { INCLUDE_MESSAGES } from './include-tables.ts'
import { type HeadingIds } from './options.ts'
import { headingIdsAlone } from './resolve.ts'

type Child = NonNullable<IncludeNode['children']>[number]

/** C2-N-029: the block lists of the file's body below `node`. A footnote, a caption and a table hold none. */
function innerLists(node: Node): readonly (readonly Node[])[] {
  if (node.type === 'list') return node.children.map((item) => item.children)
  if (node.type === 'definition_list') {
    return node.children.flatMap((child) => (child.type === 'definition_description' ? [child.children] : []))
  }
  if (node.type === 'footnote' || node.type === 'caption') return []
  return isBlockParent(node) ? [node.children] : []
}

/** C2-N-029: a definition, a comment, frontmatter or an include, whose attributes are inert (C2-N-072), selects nothing. */
function isSelectable(node: Node): boolean {
  return !DEFINITION_TYPES.includes(node.type) && node.type !== 'comment' && node.type !== 'frontmatter' && node.type !== 'include'
}

interface Place {
  list: readonly Node[]
  at: number
}

/** The first block of the lists, a container before the blocks inside it, for which `test` holds. */
function findBlock(lists: readonly (readonly Node[])[], test: (node: Node) => boolean): Place | null {
  for (const list of lists) {
    for (let at = 0; at < list.length; at++) {
      const node = list[at]!
      if (test(node)) return { list, at }
      const inner = findBlock(innerLists(node), test)
      if (inner !== null) return inner
    }
  }
  return null
}

/** C2-N-028: a heading and the blocks after it in its sequence, up to the next heading of its level or a lower number. */
function sectionOf(place: Place, level: number): Node[] {
  let end = place.at + 1
  while (end < place.list.length) {
    const next = place.list[end]!
    if (next.type === 'heading' && next.level <= level) break
    end++
  }
  return place.list.slice(place.at, end)
}

function eachNode(nodes: readonly Node[], visit: (node: Node) => void): void {
  const pending: Node[] = [...nodes].reverse()
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    visit(node)
    const below: Node[] = []
    forEachSlot(node, (list) => { below.push(...list) })
    for (let at = below.length - 1; at >= 0; at--) pending.push(below[at]!)
  }
}

/** The facts of a selection keep the findings of its own nodes only. */
function keptFacts(facts: ParseFacts, kept: ReadonlySet<Node>, includes: readonly IncludeNode[]): ParseFacts {
  return {
    ...facts,
    includes,
    addFindings: (findings) => {
      const all: Findings = { entries: [], nodes: [] }
      facts.addFindings(all)
      all.entries.forEach((entry, at) => {
        const node = all.nodes[at] ?? null
        if (node !== null && kept.has(node)) addFinding(findings, node, entry)
      })
    },
  }
}

function isChild(node: Node): node is Child {
  return node.type !== 'document'
}

/** C2-N-027 to C2-N-031: the selected blocks, then every definition of the file the selection did not take. */
export function selectSection(parsed: ParsedTree, name: string, mode: HeadingIds): Selected | null {
  const document = parsed.document
  const ids = headingIdsAlone(document, mode)
  const lists = [document.children]
  const heading = findBlock(lists, (node) => node.type === 'heading' && ids.get(node) === name)
  const first = heading?.list[heading.at]
  const block = heading === null ? findBlock(lists, (node) => isSelectable(node) && node.attrs?.id === name) : null
  let selected: Node[]
  if (heading !== null && first?.type === 'heading') selected = sectionOf(heading, first.level)
  else if (block !== null) selected = [block.list[block.at]!]
  else return null
  const taken = new Set(selected)
  const definitions = document.children.filter((node) => DEFINITION_TYPES.includes(node.type) && !taken.has(node))
  const children = [...selected, ...definitions].filter(isChild)
  const kept = new Set<Node>()
  const includes: IncludeNode[] = []
  eachNode(children, (node) => {
    kept.add(node)
    if (node.type === 'include') includes.push(node)
  })
  const facts = parsed.facts === null ? null : keptFacts(parsed.facts, kept, includes)
  return { children, facts, includes, scope: parsed.facts?.scope ?? { abbreviations: new Map(), linkKeys: null } }
}

const MIN_LEVEL = 1
const MAX_LEVEL = 6

interface ShiftWalk {
  /** The level of the last heading of each open container, innermost last; 0 for none yet. */
  levels: number[]
  findings: Findings
}

function headingsOf(nodes: readonly Node[]): HeadingNode[] {
  const headings: HeadingNode[] = []
  eachNode(nodes, (node) => {
    if (node.type === 'heading') headings.push(node)
  })
  return headings
}

/** C2-N-049: the level of the nearest heading before the include, in its container or one around it. */
function contextLevel(walk: ShiftWalk): number {
  for (let at = walk.levels.length - 1; at >= 0; at--) if (walk.levels[at]! > 0) return walk.levels[at]!
  return 0
}

/** C2-N-048, C2-N-049: adds the shift to every heading among the children, clamped to levels 1 to 6. */
function shiftInclude(walk: ShiftWalk, node: IncludeNode, shift: number | 'auto'): void {
  const headings = headingsOf(node.children ?? [])
  if (headings.length === 0) return
  const lowest = Math.min(...headings.map((heading) => heading.level))
  const by = shift === 'auto' ? contextLevel(walk) + 1 - lowest : shift
  if (by === 0) return
  for (const heading of headings) {
    const level = heading.level + by
    heading.level = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, level))
    if (heading.level === level) continue
    const text = plainText(heading.children)
    const template = INCLUDE_MESSAGES.get('include-heading-clamp') ?? ''
    const message = template.replace('${text}', text).replace('${level}', String(heading.level))
    addFinding(walk.findings, heading, { code: 'include-heading-clamp', severity: 'warning', channel: 'parse', message })
  }
}

function shiftList(walk: ShiftWalk, nodes: readonly Node[]): void {
  for (const node of nodes) shiftNode(walk, node)
}

/** C2-N-050: include by include in tree order, an include before the includes inside it. An include is no container. */
function shiftNode(walk: ShiftWalk, node: Node): void {
  if (node.type === 'heading') {
    walk.levels[walk.levels.length - 1] = node.level
    return
  }
  if (node.type === 'include') {
    const shift = node.options?.shift
    if (node.children !== undefined && shift !== undefined) shiftInclude(walk, node, shift)
    shiftList(walk, node.children ?? [])
    return
  }
  // A footnote body is a container of its own; no section is selected from one (C2-N-029), but it is shifted.
  for (const list of node.type === 'footnote' ? [node.children] : innerLists(node)) {
    walk.levels.push(0)
    shiftList(walk, list)
    walk.levels.pop()
  }
}

/** C2-N-048 to C2-N-051: the shifts of an expanded tree. */
export function applyShifts(document: DocumentNode, findings: Findings): void {
  const walk: ShiftWalk = { levels: [0], findings }
  shiftList(walk, document.children)
}
