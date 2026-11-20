// The editor adapters of the importer (C2-M-102 to C2-M-106).
import { defaultTreeAdapter, html, type DefaultTreeAdapterTypes as Html } from 'parse5'
import { attr, classList, content, elements, has, isBlank, isComment, isElement } from './html-dom.ts'
import { isBacklink, isFootnoteSection } from './html-notes.ts'
import { CarveOptionError } from '../../src/options.ts'

export const ADAPTERS = ['generic', 'tiptap', 'prosemirror', 'ckeditor', 'tinymce', 'word', 'google-docs'] as const
export type Adapter = typeof ADAPTERS[number]

const NOTE_PASS: ReadonlySet<string> = new Set(['word', 'google-docs'])
const BLOCKS: ReadonlySet<string> = new Set(['li', 'div', 'section', 'aside', 'p', 'td', 'blockquote'])
const WRAPPERS: ReadonlySet<string> = new Set(['div', 'li', 'section', 'aside'])
const KEY_PREFIXES = ['user-content-fn-', 'fn-', 'fn']

type Parent = Html.ParentNode

interface Candidate { ref: Html.Element, block: Html.Element, fragment: string }
interface Note { block: Html.Element, refs: Html.Element[], fragments: Set<string> }

/** C2-M-102: the value of the option `adapter`, refused with `CarveOptionError` when it names no adapter. */
export function readAdapter(value: unknown): Adapter {
  if (value === undefined) return 'generic'
  if (typeof value === 'string' && (ADAPTERS as readonly string[]).includes(value)) return value as Adapter
  throw new CarveOptionError('adapter', `unknown value ${JSON.stringify(value)}`)
}

/** C2-M-102: `word` and `google-docs` run the note pass; every other adapter leaves the tree as it is. */
export function applyAdapter(roots: Parent, adapter: Adapter): void {
  if (NOTE_PASS.has(adapter)) notePass(roots)
}

function hrefFragment(node: Html.Element): string | undefined {
  const href = attr(node, 'href')
  return href !== undefined && href.length > 1 && href.startsWith('#') ? href.slice(1) : undefined
}

function identity(node: Html.Element): string {
  const id = attr(node, 'id')
  return id !== undefined && id !== '' ? id : attr(node, 'name') ?? ''
}

function isMarkedReference(node: Html.Element): boolean {
  return classList(node).some(name => name === 'footnote-ref' || name === 'footnoteRef')
}

function isTopLevel(node: Html.Element): boolean {
  return node.tagName === 'body' || node.tagName === 'html'
}

function noteKey(id: string): string {
  for (const prefix of KEY_PREFIXES) if (id.startsWith(prefix)) return id.slice(prefix.length)
  return id
}

/** Edits in place: a removed child keeps its slot until `finish`, so each edit costs no scan of its siblings. */
class Edits {
  private readonly slots = new Map<Parent, Map<Html.ChildNode, number>>()
  private readonly gone = new Set<Html.ChildNode>()

  private slot(node: Html.ChildNode): [Parent, number] | undefined {
    const parent = node.parentNode
    if (parent === null) return undefined
    let slots = this.slots.get(parent)
    if (slots === undefined) {
      slots = new Map(parent.childNodes.map((child, at) => [child, at]))
      this.slots.set(parent, slots)
    }
    const at = slots.get(node)
    return at === undefined ? undefined : [parent, at]
  }

  isGone(node: Html.ChildNode): boolean { return this.gone.has(node) }

  /** The children of `parent` that are still there. */
  children(parent: Parent): Html.ChildNode[] { return parent.childNodes.filter(child => !this.gone.has(child)) }

  /** The child before `node` that is still there, or undefined. */
  before(node: Html.ChildNode): Html.ChildNode | undefined {
    const found = this.slot(node)
    if (found === undefined) return undefined
    const [parent, at] = found
    for (let index = at - 1; index >= 0; index--) {
      const child = parent.childNodes[index]!
      if (!this.gone.has(child)) return child
    }
    return undefined
  }

  detach(node: Html.ChildNode): void {
    if (this.slot(node) === undefined) return
    this.gone.add(node)
  }

  replace(node: Html.ChildNode, replacement: Html.Element): void {
    const found = this.slot(node)
    if (found === undefined) return
    const [parent, at] = found
    parent.childNodes[at] = replacement
    replacement.parentNode = parent
    this.slots.get(parent)!.set(replacement, at)
    this.slots.get(parent)!.delete(node)
    node.parentNode = null
  }

  /** The parent of `node`, null once it is removed. */
  parentOf(node: Html.ChildNode): Parent | null { return this.gone.has(node) ? null : node.parentNode }

  finish(): void {
    for (const parent of this.slots.keys()) {
      if (!parent.childNodes.some(child => this.gone.has(child))) continue
      parent.childNodes = parent.childNodes.filter(child => {
        if (!this.gone.has(child)) return true
        child.parentNode = null
        return false
      })
    }
  }
}

function element(tagName: string, attrs: Record<string, string>, children: Html.ChildNode[] = []): Html.Element {
  const node = defaultTreeAdapter.createElement(tagName, html.NS.HTML, Object.entries(attrs).map(([name, value]) => ({ name, value })))
  for (const child of children) {
    child.parentNode = node
    node.childNodes.push(child)
  }
  // The moved children leave their old parent's list, which is never read again.
  return node
}

/** C2-M-105: whitespace, comments, `<hr>` and `<br>` are the layout of the export, not content. */
function isLayout(node: Html.ChildNode): boolean {
  return isBlank(node) || isComment(node) || (isElement(node) && (node.tagName === 'hr' || node.tagName === 'br'))
}

/** The elements in document order, with the end of each subtree as an index. */
class Walk {
  readonly order: Html.Element[] = []
  readonly index = new Map<Html.Element, number>()
  readonly end = new Map<Html.Element, number>()
  readonly sections: Html.Element[] = []

  constructor(roots: Parent) {
    const stack: Array<{ node: Html.Element, exit: boolean }> = []
    const push = (nodes: Html.ChildNode[]): void => {
      for (let at = nodes.length - 1; at >= 0; at--) {
        const node = nodes[at]!
        if (isElement(node)) stack.push({ node, exit: false })
      }
    }
    push(roots.childNodes)
    while (stack.length > 0) {
      const { node, exit } = stack.pop()!
      if (exit) {
        this.end.set(node, this.order.length - 1)
        continue
      }
      if (node.tagName === 'section' && isFootnoteSection(node)) this.sections.push(node)
      this.index.set(node, this.order.length)
      this.order.push(node)
      stack.push({ node, exit: true })
      push(content(node))
    }
  }

  contains(outer: Html.Element, inner: Html.Element): boolean {
    const start = this.index.get(outer)!
    const at = this.index.get(inner)!
    return at >= start && at <= this.end.get(outer)!
  }
}

/** The positions of the `<a>` elements of each `href`, in document order. */
function anchorsByHref(walk: Walk): Map<string, number[]> {
  const result = new Map<string, number[]>()
  walk.order.forEach((node, at) => {
    if (node.tagName !== 'a') return
    const href = attr(node, 'href')
    if (href === undefined) return
    const list = result.get(href)
    if (list === undefined) result.set(href, [at])
    else list.push(at)
  })
  return result
}

function firstAtOrAfter(list: number[], value: number): number {
  let low = 0
  let high = list.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (list[middle]! < value) low = middle + 1
    else high = middle
  }
  return low
}

/** C2-M-103: an anchor names an element by its fragment, and is no note reference or backlink that C2-M-062 and C2-M-063 read. */
function isAnchor(node: Html.Element, targets: Map<string, Html.Element>): boolean {
  if (node.tagName !== 'a' || attr(node, 'role') === 'doc-noteref' || has(node, 'data-footnote-ref') || isBacklink(node)) return false
  const fragment = hrefFragment(node)
  return fragment !== undefined && targets.has(fragment)
}

function fragmentTargets(walk: Walk): Map<string, Html.Element> {
  const targets = new Map<string, Html.Element>()
  for (const node of walk.order) {
    const id = attr(node, 'id')
    if (id !== undefined && id !== '' && !targets.has(id)) targets.set(id, node)
  }
  for (const node of walk.order) {
    const name = node.tagName === 'a' ? attr(node, 'name') : undefined
    if (name !== undefined && name !== '' && !targets.has(name)) targets.set(name, node)
  }
  return targets
}

/** How many elements that an anchor's fragment names each element holds, itself included. */
function namedCounts(walk: Walk, named: Set<Html.Element>): Map<Html.Element, number> {
  const held = new Map<Html.Element, number>()
  for (let at = walk.order.length - 1; at >= 0; at--) {
    const node = walk.order[at]!
    const count = (held.get(node) ?? 0) + (named.has(node) ? 1 : 0)
    held.set(node, count)
    const parent = node.parentNode as Html.ChildNode | null
    if (parent !== null && isElement(parent)) held.set(parent, (held.get(parent) ?? 0) + count)
  }
  return held
}

/** C2-M-103: the block of a named element, or its one-note wrapper. */
function blockOf(target: Html.Element, held: Map<Html.Element, number>): Html.Element | undefined {
  let node: Html.Element | undefined = target
  while (node !== undefined && !BLOCKS.has(node.tagName)) {
    const parent = node.parentNode as Html.ChildNode | null
    node = parent !== null && isElement(parent) && !isTopLevel(parent) ? parent : undefined
  }
  if (node === undefined) return undefined
  const parent = node.parentNode as Html.ChildNode | null
  const wraps = parent !== null && isElement(parent) && WRAPPERS.has(parent.tagName) && (attr(parent, 'id') ?? '') !== ''
    && held.get(parent) === 1
  return wraps ? parent : node
}

/** The positions of the `<a>` elements inside `block` whose `href` is `href`. */
function hrefsIn(walk: Walk, byHref: Map<string, number[]>, block: Html.Element, href: string): number[] {
  const list = byHref.get(href) ?? []
  return list.slice(firstAtOrAfter(list, walk.index.get(block)!), firstAtOrAfter(list, walk.end.get(block)! + 1))
}

/** C2-M-104: of two candidates inside each other's block, whether `first` is the reference. */
function wins(walk: Walk, first: Candidate, second: Candidate): boolean {
  const firstMarked = isMarkedReference(first.ref)
  if (firstMarked !== isMarkedReference(second.ref)) return firstMarked
  const secondBack = classList(second.ref).includes('footnote-back')
  if (classList(first.ref).includes('footnote-back') !== secondBack) return secondBack
  return walk.index.get(first.ref)! < walk.index.get(second.ref)!
}

/** C2-M-104: the candidates that are references, each with its block. */
function references(walk: Walk, anchors: Html.Element[], targets: Map<string, Html.Element>): Candidate[] {
  const held = namedCounts(walk, new Set(anchors.map(anchor => targets.get(hrefFragment(anchor)!)!)))
  const byHref = anchorsByHref(walk)
  const candidates = new Map<Html.Element, Candidate>()
  for (const anchor of anchors) {
    const fragment = hrefFragment(anchor)!
    const block = blockOf(targets.get(fragment)!, held)
    if (block === undefined || walk.contains(block, anchor)) continue
    const own = identity(anchor)
    const mutual = own !== '' && hrefsIn(walk, byHref, block, `#${own}`).length > 0
    if (mutual || isMarkedReference(anchor)) candidates.set(anchor, { ref: anchor, block, fragment })
  }
  const inverseOf = (candidate: Candidate): Candidate | undefined => {
    const own = identity(candidate.ref)
    if (own === '') return undefined
    for (const at of hrefsIn(walk, byHref, candidate.block, `#${own}`)) {
      const inverse = candidates.get(walk.order[at]!)
      if (inverse !== undefined) return walk.contains(inverse.block, candidate.ref) ? inverse : undefined
    }
    return undefined
  }
  return [...candidates.values()].filter(candidate => {
    const inverse = inverseOf(candidate)
    return inverse === undefined || !wins(walk, inverse, candidate)
  })
}

/** C2-M-104: one note per block, in document order, without a block that contains another note. */
function notesOf(walk: Walk, kept: Candidate[]): Note[] {
  const groups = new Map<Html.Element, Note>()
  for (const candidate of kept) {
    const note = groups.get(candidate.block) ?? { block: candidate.block, refs: [], fragments: new Set<string>() }
    note.refs.push(candidate.ref)
    note.fragments.add(candidate.fragment)
    groups.set(candidate.block, note)
  }
  const sorted = [...groups.values()].sort((a, b) => walk.index.get(a.block)! - walk.index.get(b.block)!)
  // In document order a block that contains another note contains the next one.
  return sorted.filter((note, at) => {
    const next = sorted[at + 1]
    return next === undefined || !walk.contains(note.block, next.block)
  })
}

/** C2-M-104: every other anchor outside the notes whose fragment is that of a reference binds to the same note. */
function attachRemaining(walk: Walk, notes: Note[], anchors: Html.Element[]): void {
  const starts = notes.map(note => walk.index.get(note.block)!)
  const insideNote = (node: Html.Element): boolean => {
    const slot = firstAtOrAfter(starts, walk.index.get(node)! + 1) - 1
    return slot >= 0 && walk.contains(notes[slot]!.block, node)
  }
  const byFragment = new Map<string, Note>()
  for (const note of notes) for (const fragment of note.fragments) if (!byFragment.has(fragment)) byFragment.set(fragment, note)
  for (const anchor of anchors) {
    const note = byFragment.get(hrefFragment(anchor)!)
    if (note === undefined || note.refs.includes(anchor) || insideNote(anchor)) continue
    note.refs.push(anchor)
  }
}

function notePass(roots: Parent): void {
  const walk = new Walk(roots)
  const targets = fragmentTargets(walk)
  const anchors = walk.order.filter(node => isAnchor(node, targets))
  if (anchors.length === 0) return
  const notes = notesOf(walk, references(walk, anchors, targets))
  if (notes.length === 0) return
  attachRemaining(walk, notes, anchors)
  rewrite(roots, walk, notes)
}

/** The items of the first list of each footnote section: the notes C2-M-061 reads where they stand. */
function sectionItems(walk: Walk): Set<Html.Element> {
  const items = new Set<Html.Element>()
  for (const section of walk.sections) {
    const list = elements(section).find(child => child.tagName === 'ol')
    for (const item of list === undefined ? [] : elements(list)) if (item.tagName === 'li') items.add(item)
  }
  return items
}

function rewrite(roots: Parent, walk: Walk, notes: Note[]): void {
  const edits = new Edits()
  const items = sectionItems(walk)
  const taken = new Set<string>()
  for (const item of items) {
    const id = attr(item, 'id')
    if (id !== undefined && id !== '') taken.add(noteKey(id))
  }
  // C2-M-105: a note that is an item of a footnote section keeps its place and its id.
  const stays = (note: Note): boolean => items.has(note.block) && (attr(note.block, 'id') ?? '') !== ''
  let next = 1
  const hrefs = notes.map(note => {
    if (stays(note)) return `#${attr(note.block, 'id')!}`
    while (taken.has(String(next))) next++
    return `#fn${next++}`
  })

  // C2-M-105: every reference site is replaced before any note leaves, since a note can hold the reference to another.
  notes.forEach((note, at) => {
    for (const ref of note.refs) {
      const parent = ref.parentNode as Html.ChildNode | null
      const site = parent !== null && isElement(parent) && parent.tagName === 'sup'
        && content(parent).every(child => child === ref || isBlank(child)) ? parent : ref
      edits.replace(site, element('a', { role: 'doc-noteref', href: hrefs[at]! }, [defaultTreeAdapter.createTextNode(String(at + 1))]))
    }
  })
  for (const note of notes) dropBacklinks(note, walk, edits)
  const moving = notes.map((note, at) => ({ note, href: hrefs[at]! })).filter(({ note }) => !stays(note))
  if (moving.length === 0) {
    edits.finish()
    return
  }
  dropSeparator(moving[0]!.note.block, edits)

  const moved: Html.Element[] = []
  const emptied = new Set<Parent>()
  for (const { note, href } of moving) {
    const parent = edits.parentOf(note.block)
    edits.detach(note.block)
    if (parent !== null) emptied.add(parent)
    moved.push(element('li', { id: href.slice(1) }, edits.children(note.block)))
  }
  for (const parent of emptied) pruneEmpty(parent, edits)
  edits.finish()

  const section = element('section', { role: 'doc-endnotes' }, [element('ol', {}, moved)])
  const body = findBody(roots)
  section.parentNode = body
  body.childNodes.push(section)
}

/** C2-M-105: a backlink names a reference of its note, or is the element a reference's fragment names. */
function dropBacklinks(note: Note, walk: Walk, edits: Edits): void {
  const identities = new Set(note.refs.map(identity).filter(value => value !== ''))
  const start = walk.index.get(note.block)!
  const backlinks = walk.order.slice(start, walk.end.get(note.block)! + 1).filter(node => node.tagName === 'a'
    && node.parentNode !== null && (identities.has(hrefFragment(node) ?? '')
      || (hrefFragment(node) !== undefined && note.fragments.has(identity(node)))
      || classList(node).includes('footnote-back') || isBacklink(node)))
  for (const backlink of backlinks) {
    const parent = edits.parentOf(backlink) as Html.ChildNode | null
    edits.detach(backlink)
    if (parent !== null && isElement(parent) && (parent.tagName === 'sup' || parent.tagName === 'span')
      && edits.children(parent).every(isBlank)) edits.detach(parent)
  }
}

/** C2-M-105: the rule and line breaks before the first note, on its level and on each level above it. */
function dropSeparator(first: Html.Element, edits: Edits): void {
  let node: Html.ChildNode = first
  for (;;) {
    let sibling = edits.before(node)
    while (sibling !== undefined && isLayout(sibling)) {
      const previous = edits.before(sibling)
      if (isElement(sibling)) edits.detach(sibling)
      sibling = previous
    }
    const parent = edits.parentOf(node) as Html.ChildNode | null
    if (sibling !== undefined || parent === null || !isElement(parent) || isTopLevel(parent)) return
    node = parent
  }
}

/** C2-M-105: an element the notes left with layout only gives nothing, nor its parent, up to the `<body>`. */
function pruneEmpty(start: Parent, edits: Edits): void {
  let node: Html.ChildNode = start as Html.ChildNode
  while (isElement(node) && !isTopLevel(node) && !edits.isGone(node) && node.parentNode !== null
    && edits.children(node).every(isLayout)) {
    const parent: Parent = node.parentNode
    edits.detach(node)
    node = parent as Html.ChildNode
  }
}

function findBody(roots: Parent): Parent {
  for (const node of roots.childNodes) {
    if (!isElement(node) || node.tagName !== 'html') continue
    const body = elements(node).find(child => child.tagName === 'body')
    if (body !== undefined) return body
  }
  return roots
}
