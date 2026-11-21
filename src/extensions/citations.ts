// Citations: `:cite[key]` resolved against the entries of a `bibliography` or `references` directive (C2-X-058) and
// an optional CSL-JSON pool, with a generated list of the entries.
import { type Block, type BlockExtensionNode, type DefinitionListNode, type DefinitionTermNode, type DirectiveNode,
  type DocumentNode, type Inline, type InlineExtensionNode, type ListNode, type Node } from '../ast.ts'
import { plainText } from '../ast-text.ts'
import { type ExtensionBundle, attribute, claimDirective, coreBlocks, declare, directiveDefinition, freshId,
  inlineAttributes, slotRenderer, viewIds, walkView } from './apparatus.ts'
import { type ExtensionClaim, type ExtensionDefinition, type ExtensionRenderer, type ExtensionRenderHost } from './types.ts'

const CITE = 'carve.cite'
const REFERENCES = 'carve.references'
/** The attributes the citation reads as its own options; they are not written on the element. */
const OWN = ['locator', 'prefix', 'suffix', 'mode']

/** A CSL-JSON name object, the subset the formatter reads. */
export interface CslName {
  family?: string
  given?: string
  literal?: string
}

/** A CSL-JSON entry, the subset the formatter reads; other fields are ignored. */
export interface CslEntry {
  id: string
  author?: CslName[]
  issued?: { 'date-parts'?: number[][], literal?: string }
  title?: string
  [key: string]: unknown
}

export interface CitationsOptions {
  /** `numbered` (default) writes `[1]`; `author-date` writes `(Author Year)`. */
  mode?: 'numbered' | 'author-date'
  /**
   * An external CSL-JSON pool. Keys resolve against the document's entries first, then this pool. When it is given, even
   * empty, each use gets an id and each listed entry back-links to its uses. The extension reads no file.
   */
  bibliography?: readonly CslEntry[]
}

interface Entry { blocks: Block[], author?: string, year?: string }

/** The keys of the content, split at `;`. */
function citeKeys(text: string): string[] {
  return text.split(';').map((key) => key.trim()).filter((key) => key !== '')
}

function citeTransform(claim: ExtensionClaim): InlineExtensionNode | null {
  if (claim.form !== 'inline') return null
  const text = plainText(claim.children)
  const keys = citeKeys(text)
  if (keys.length === 0) return null
  return { type: 'inline_extension', name: CITE, version: '1', children: [], props: { keys },
    fallback: [{ type: 'text', value: text }] }
}

/** C2-X-058: the registered `cite` matcher. Without the transform each citation keeps its core-text fallback. */
export const citeExtension: ExtensionDefinition = {
  name: CITE, version: '1', matcher: { form: 'inline', name: 'cite' },
  props: { keys: 'array', refs: 'array' }, slots: {}, children: 'none', transform: citeTransform,
}

export const referencesExtension: ExtensionDefinition = directiveDefinition(REFERENCES)

function isReferences(node: Node): node is DirectiveNode {
  return node.type === 'directive' && (node.kind === 'references' || node.kind === 'bibliography')
}

/** A document without a citation or a placement directive cannot gain a bibliography. */
function hasCitationWork(view: DocumentNode): boolean {
  let found = false
  walkView(view, (node) => {
    if (isReferences(node) || (node.type === 'inline_extension' && node.name === CITE)) found = true
    return found ? false : undefined
  })
  return found
}

function formatName(name: CslName): string {
  if (name === null || typeof name !== 'object') return ''
  if (typeof name.literal === 'string' && name.literal !== '') return name.literal
  if (typeof name.family === 'string' && typeof name.given === 'string' && name.given !== '') return `${name.family}, ${name.given}`
  return typeof name.family === 'string' ? name.family : ''
}

function cslYear(issued: CslEntry['issued']): string {
  const year = issued?.['date-parts']?.[0]?.[0]
  if (typeof year === 'number') return String(year)
  return typeof issued?.literal === 'string' ? issued.literal : ''
}

/** The fixed template of 0.1: `Family, Given (Year). Title.`, with missing parts and their separators left out. */
function cslEntry(csl: CslEntry): Entry {
  const authors = Array.isArray(csl.author) ? csl.author : []
  const year = cslYear(csl.issued)
  let head = authors.map(formatName).filter((name) => name !== '').join('; ')
  if (year !== '') head = head === '' ? `(${year})` : `${head} (${year})`
  const parts = [head, typeof csl.title === 'string' ? csl.title : ''].filter((part) => part !== '')
  const text = parts.length === 0 ? '' : `${parts.join('. ')}.`
  const entry: Entry = { blocks: text === '' ? [] : [{ type: 'paragraph', children: [{ type: 'text', value: text }] }] }
  const first = authors[0]
  const author = first !== null && typeof first === 'object' ? first.literal ?? first.family : undefined
  if (typeof author === 'string') entry.author = author
  if (year !== '') entry.year = year
  return entry
}

/** The entries of one description list: each run of terms takes the description that follows it. */
function listEntries(list: DefinitionListNode, entries: Map<string, Entry>, keys: string[]): void {
  let terms: string[] = []
  let facts: Omit<Entry, 'blocks'> = {}
  let open = false
  for (const item of list.children) {
    if (item.type === 'definition_term') {
      if (open) terms = []
      open = false
      terms.push(plainText(item.children).trim())
      facts = authorYear(item)
    } else if (item.type === 'definition_description') {
      open = true
      // The last entry of a duplicate key wins, as in 0.1.
      for (const key of terms) if (key !== '') {
        entries.set(key, { blocks: item.children, ...facts })
        keys.push(key)
      }
    }
  }
}

/**
 * The `author` and `year` attributes that the author-date mode reads. A term takes no attributes of its own in source,
 * so a span around the key carries them: `:: [doe]{author="Doe" year="2020"}`.
 */
function authorYear(term: DefinitionTermNode): Omit<Entry, 'blocks'> {
  const span = term.children.find((child) => child.type === 'span')
  const author = attribute(term, 'author') ?? (span === undefined ? undefined : attribute(span, 'author'))
  const year = attribute(term, 'year') ?? (span === undefined ? undefined : attribute(span, 'year'))
  return { ...author === undefined ? {} : { author }, ...year === undefined ? {} : { year } }
}

/** C2-X-058: each term of a description list in the directive is a key, and its description the entry. */
function collectEntries(view: DocumentNode, pool: readonly CslEntry[]): {
  entries: Map<string, Entry>, directives: Map<DirectiveNode, string[]>
} {
  const entries = new Map<string, Entry>()
  const directives = new Map<DirectiveNode, string[]>()
  walkView(view, (node) => {
    if (!isReferences(node)) return undefined
    const keys: string[] = []
    for (const list of node.children) if (list.type === 'definition_list') listEntries(list, entries, keys)
    directives.set(node, keys)
    return false
  })
  for (const csl of pool) {
    if (csl !== null && typeof csl === 'object' && typeof csl.id === 'string' && !entries.has(csl.id)) entries.set(csl.id, cslEntry(csl))
  }
  // A duplicate key resolves to its last definition and has one list item, as in the 0.1 catalog.
  const last = new Map<string, DirectiveNode>()
  for (const [node, keys] of directives) for (const key of keys) last.set(key, node)
  for (const [node, keys] of directives) {
    const seen = new Set<string>()
    const kept: string[] = []
    for (let at = keys.length - 1; at >= 0; at--) {
      const key = keys[at] ?? ''
      if (last.get(key) !== node || seen.has(key)) continue
      seen.add(key)
      kept.push(key)
    }
    directives.set(node, kept.reverse())
  }
  return { entries, directives }
}

interface Use { node: InlineExtensionNode, keys: string[] }

/** The citations in document order: the body first, then the notes, as 0.1 numbered them. */
function citationUses(view: DocumentNode): Use[] {
  const body: Use[] = []
  const notes: Use[] = []
  const visit = (into: Use[]) => (node: Node): false | undefined => {
    if (isReferences(node)) return false
    if ((node.type === 'footnote' || node.type === 'inline_footnote') && into === body) {
      const note: Node = node.type === 'footnote' ? node : { type: 'paragraph', children: [node] }
      walkView({ type: 'document', astVersion: '2.0', children: [note as Block] }, visit(notes))
      return false
    }
    if (node.type !== 'inline_extension' || node.name !== CITE) return undefined
    const keys = node.props?.['keys']
    if (Array.isArray(keys)) into.push({ node, keys: keys.filter((key): key is string => typeof key === 'string') })
    return false
  }
  walkView(view, visit(body))
  return [...body, ...notes]
}

function entryLabel(entry: Entry, number: number, mode: CitationsOptions['mode'], suppress: boolean): string {
  if (mode !== 'author-date') return String(number)
  if (suppress) return entry.year ?? String(number)
  return `${entry.author ?? ''} ${entry.year ?? ''}`.trim() || String(number)
}

function backlinks(ids: readonly string[]): Inline[] {
  const out: Inline[] = []
  for (const id of ids) {
    out.push({ type: 'text', value: ' ' })
    out.push({ type: 'link', href: `#${id}`, attrs: { classes: ['ref-backref'] }, children: [{ type: 'text', value: '↩' }] })
  }
  return out
}

function listItem(entry: Entry, id: string, uses: readonly string[]): ListNode['children'][number] {
  const blocks = coreBlocks(entry.blocks)
  const links = backlinks(uses)
  const first = blocks[0]
  let children: Block[]
  if (blocks.length === 1 && first?.type === 'paragraph') {
    children = [{ type: 'paragraph', children: [...first.children, ...links] }]
  } else if (blocks.length === 0) {
    children = links.length === 0 ? [] : [{ type: 'paragraph', children: links.slice(1) }]
  } else {
    children = links.length === 0 ? blocks : [...blocks, { type: 'paragraph', children: links.slice(1) }]
  }
  return { type: 'list_item', attrs: { id }, children }
}

function referenceList(order: readonly string[], entries: Map<string, Entry>, refIds: Map<string, string>,
  useIds: Map<string, string[]>, mode: CitationsOptions['mode'], sourceOrder = false, start = 1): ListNode {
  const keys = [...order]
  if (mode === 'author-date' && !sourceOrder) keys.sort((a, b) => compare(entries.get(a)?.author ?? a, entries.get(b)?.author ?? b))
  const items = keys.map((key) => listItem(entries.get(key) ?? { blocks: [] }, refIds.get(key) ?? key, useIds.get(key) ?? []))
  const marker: ListNode['marker'] = mode === 'author-date'
    ? { kind: 'bullet', char: '-' } : { kind: 'ordered', style: '1', delimiter: '.', ...(start === 1 ? {} : { start }) }
  return { type: 'list', marker, spacing: 'tight', attrs: { classes: ['references'] }, children: items }
}

/** Code point order, so every host sorts alike. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** The directive's blocks without the description lists the entries came from. */
function withoutEntries(node: DirectiveNode): DirectiveNode {
  const body = structuredClone(node)
  body.children = body.children.filter((child) => child.type !== 'definition_list' ||
    !(child as DefinitionListNode).children.some((item) => item.type === 'definition_description'))
  return body
}

function citationsTransform(view: DocumentNode, options: CitationsOptions): DocumentNode {
  const mode = options.mode ?? 'numbered'
  const backlinked = options.bibliography !== undefined
  const { entries, directives } = collectEntries(view, options.bibliography ?? [])
  const taken = viewIds(view)
  const numbers = new Map<string, number>()
  const order: string[] = []
  const refIds = new Map<string, string>()
  const useIds = new Map<string, string[]>()
  const sourceKeys = new Set<string>()
  for (const keys of directives.values()) for (const key of keys) {
    sourceKeys.add(key)
    if (numbers.has(key)) continue
    numbers.set(key, numbers.size + 1)
    refIds.set(key, freshId(`ref-${key}`, taken))
  }
  for (const { node, keys } of citationUses(view)) {
    // A citation with an undefined key keeps its text, as in 0.1: it is no use and takes no number.
    if (!keys.every((key) => entries.has(key))) continue
    const suppress = attribute(node, 'mode') === 'suppress-author'
    const refs = keys.map((key) => {
      if (!numbers.has(key)) {
        numbers.set(key, numbers.size + 1)
        order.push(key)
        refIds.set(key, freshId(`ref-${key}`, taken))
      }
      const ref: Record<string, string> = { key, href: `#${refIds.get(key) ?? ''}`,
        label: entryLabel(entries.get(key) ?? { blocks: [] }, numbers.get(key) ?? 0, mode, suppress) }
      if (backlinked) {
        const uses = useIds.get(key) ?? []
        ref['id'] = freshId(`cite-${key}-${uses.length + 1}`, taken)
        uses.push(ref['id'])
        useIds.set(key, uses)
      }
      return ref
    })
    node.props = { ...node.props, refs }
  }
  let placed = false
  let claimed = false
  walkView(view, (node) => {
    if (!isReferences(node)) return undefined
    const body = withoutEntries(node)
    const keys = directives.get(node) ?? []
    const listKeys = placed ? keys : [...keys, ...order.filter((key) => !sourceKeys.has(key))]
    body.children.push(referenceList(listKeys, entries, refIds, useIds, mode, true, numbers.get(listKeys[0] ?? '') ?? 1))
    placed = true
    claimed = true
    return claimDirective(REFERENCES, node, [body])
  })
  if (!placed && order.length > 0) {
    // No directive places the list: it goes at the end of the document, as in 0.1.
    const list = referenceList(order, entries, refIds, useIds, mode)
    view.children.push({ type: 'block_extension', name: REFERENCES, version: '1', children: [], slots: { body: [list] },
      fallback: [] })
    claimed = true
  }
  if (claimed) declare(view, [referencesExtension])
  return view
}

function citationText(node: InlineExtensionNode, refs: readonly unknown[], host: ExtensionRenderHost,
  mode: CitationsOptions['mode']): string {
  const items = refs.map((value) => {
    const ref = value as Record<string, string>
    const id = ref['id'] === undefined ? '' : ` id="${host.escapeAttribute(ref['id'])}"`
    return `<a${id} href="${host.escapeAttribute(ref['href'] ?? '')}" data-cite-key="${host.escapeAttribute(ref['key'] ?? '')}">` +
      `${host.escapeText(ref['label'] ?? '')}</a>`
  })
  const part = (key: string, before: string, after: string): string => {
    const value = attribute(node, key)
    return value === undefined ? '' : `${before}${host.escapeText(value)}${after}`
  }
  const inner = `${part('prefix', '', ' ')}${items.join(mode === 'author-date' ? '; ' : ', ')}` +
    `${part('locator', ', ', '')}${part('suffix', ' ', '')}`
  return mode === 'author-date' ? `(${inner})` : `[${inner}]`
}

function renderCitation(node: BlockExtensionNode | InlineExtensionNode, host: ExtensionRenderHost, mode: CitationsOptions['mode']): string {
  if (node.type !== 'inline_extension') return ''
  const refs = node.props?.['refs']
  if (!Array.isArray(refs)) return host.inlines(node.fallback ?? [])
  const text = citationText(node, refs, host, mode)
  const integral = attribute(node, 'mode') === 'author-in-text'
  const attrs = node.attrs
  const own = attrs !== undefined && (attrs.id !== undefined || (attrs.classes?.length ?? 0) > 0 ||
    (attrs.keyValues ?? []).some(([key]) => !OWN.includes(key)))
  // As in 0.1 the citation stands bare unless it is integral or carries attributes of its own.
  if (!integral && !own) return text
  return `<span${inlineAttributes(node, host, 'citation', (key) => OWN.includes(key))}${integral ? ' data-cite-mode="integral"' : ''}>` +
    `${text}</span>`
}

export const referencesRenderer: ExtensionRenderer = slotRenderer('body')

/** The provisional standard citations extension. */
export function citations(options: CitationsOptions = {}): ExtensionBundle {
  const render = (node: BlockExtensionNode | InlineExtensionNode, host: ExtensionRenderHost): string =>
    renderCitation(node, host, options.mode)
  return {
    extensions: [citeExtension, referencesExtension],
    renderers: { [CITE]: { version: '1', render, buildTime: render }, [REFERENCES]: referencesRenderer },
    transforms: [{ name: 'citations', appliesTo: hasCitationWork, transform: (view) => citationsTransform(view, options) }],
  }
}
