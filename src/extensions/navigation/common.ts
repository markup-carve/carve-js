import { type DocumentNode, type HeadingNode, type Inline, type LinkNode, type Node } from '../../ast.ts'

const NOT_CHILDREN = new Set(['pos', 'segments', 'attrs', 'data', 'metadata', 'source', 'payload', 'props'])

function isNode(value: unknown): value is Node {
  return value !== null && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string'
}

/** What a rewrite returns for one node: `undefined` keeps it and visits its children; a list replaces it. */
export type Rewrite = (node: Node, ancestors: readonly Node[]) => Node[] | undefined

/**
 * Visits every node below `root` in document order, slots included, and splices in what `rewrite` returns. Extension
 * fallbacks are visited only with `fallbacks`, since they repeat what the slots hold.
 */
export function rewriteTree(root: Node, rewrite: Rewrite, fallbacks: boolean, ancestors: Node[] = []): void {
  ancestors.push(root)
  for (const [key, value] of Object.entries(root)) {
    if (NOT_CHILDREN.has(key) || (key === 'fallback' && !fallbacks) || value === null || typeof value !== 'object') continue
    if (Array.isArray(value)) rewriteList(value, rewrite, fallbacks, ancestors)
    else if (isNode(value)) rewriteTree(value, rewrite, fallbacks, ancestors)
    else for (const list of Object.values(value as Record<string, unknown>)) {
      if (Array.isArray(list)) rewriteList(list, rewrite, fallbacks, ancestors)
    }
  }
  ancestors.pop()
}

function rewriteList(list: unknown[], rewrite: Rewrite, fallbacks: boolean, ancestors: Node[]): void {
  for (let at = 0; at < list.length; at++) {
    const item = list[at]
    if (!isNode(item)) continue
    const replaced = rewrite(item, ancestors)
    if (replaced === undefined) {
      rewriteTree(item, rewrite, fallbacks, ancestors)
      continue
    }
    list.splice(at, 1, ...replaced)
    for (const node of replaced) rewriteTree(node, rewrite, fallbacks, ancestors)
    at += replaced.length - 1
  }
}

export function visitTree(root: Node, visit: (node: Node, ancestors: readonly Node[]) => void, fallbacks: boolean): void {
  rewriteTree(root, (node, ancestors) => {
    visit(node, ancestors)
    return undefined
  }, fallbacks)
}

/** C2-X-054: a node the transform inserts or marks is declared on the view. */
export function declare(view: DocumentNode, name: string, slots: readonly string[] = []): void {
  const declarations = view.extensions ?? []
  if (!declarations.some((entry) => entry.name === name)) declarations.push({ name, version: '1', required: false, slots: [...slots] })
  view.extensions = declarations
}

export function headingId(heading: HeadingNode): string | undefined {
  return heading.attrs?.id ?? heading.generatedId
}

/**
 * C2-X-055 allocates generated ids again over the final view, from the edited text. A transform that edits the text of
 * a heading keeps its id by writing it as the heading's id.
 */
export function pinId(heading: HeadingNode): void {
  if (heading.attrs?.id !== undefined || heading.generatedId === undefined) return
  heading.attrs = { ...heading.attrs, id: heading.generatedId }
}

/** Marks render chrome a transform inserted, such as a section number, under the name of its extension. */
export function chrome<T extends Node>(node: T, owner: string): T {
  node.data = { [owner]: 'chrome' }
  return node
}

function isChrome(node: Node): boolean {
  return node.data !== undefined && Object.values(node.data).includes('chrome')
}

/**
 * The display text a transform derives from a heading: a copy of its inlines without inserted chrome, notes and ids.
 * Links in it are unwrapped where it is written inside a link (C2-H-081).
 */
export function derivedInlines(children: readonly Inline[]): Inline[] {
  const copy = structuredClone(children.filter((node) => !isChrome(node))) as Inline[]
  const holder = { type: 'span', children: copy } as Node
  rewriteTree(holder, (node) => {
    if (isChrome(node) || node.type === 'footnote_ref' || node.type === 'inline_footnote') return []
    if (node.attrs?.id !== undefined) {
      const { id: _id, ...rest } = node.attrs
      if (Object.keys(rest).length === 0) delete node.attrs
      else node.attrs = rest
    }
    return undefined
  }, true)
  const first = copy[0]
  if (first?.type === 'text') first.value = first.value.trimStart()
  const last = copy[copy.length - 1]
  if (last?.type === 'text') last.value = last.value.trimEnd()
  return copy.filter((node) => node.type !== 'text' || node.value !== '')
}

/** Sets a pair of the attributes, replacing an authored key of any case (HTML attribute names fold case). */
export function setPair(node: Node, name: string, value: string): void {
  const pairs = (node.attrs?.keyValues ?? []).filter(([key]) => key.toLowerCase() !== name)
  pairs.push([name, value])
  node.attrs = { ...node.attrs, keyValues: pairs }
}

export function pairOf(node: Node, name: string): string | undefined {
  return node.attrs?.keyValues?.find(([key]) => key.toLowerCase() === name)?.[1]
}

export function removePair(node: Node, name: string): void {
  const pairs = node.attrs?.keyValues
  if (pairs === undefined) return
  const kept = pairs.filter(([key]) => key.toLowerCase() !== name)
  if (kept.length === pairs.length) return
  const attrs = { ...node.attrs }
  if (kept.length === 0) delete attrs.keyValues
  else attrs.keyValues = kept
  if (Object.keys(attrs).length === 0) delete node.attrs
  else node.attrs = attrs
}

function referenceKey(key: string): string {
  return key.trim().replace(/\s+/gu, ' ').toLowerCase()
}

/** Whether a link is a reference that a heading resolved (C2-H-083), before or after `freezeReferences`. */
export function headingReferences(view: DocumentNode): LinkNode[] {
  const definitions = new Set<string>()
  const links: LinkNode[] = []
  visitTree(view, (node) => {
    if (node.type === 'link_reference_definition') definitions.add(referenceKey(node.key))
    if (node.type === 'link' && node.href?.startsWith('#') === true &&
      (node.key !== undefined || Object.values(node.data ?? {}).includes(HEADING_REFERENCE))) links.push(node)
  }, true)
  return links.filter((link) => link.key === undefined || !definitions.has(referenceKey(link.key)))
}

const HEADING_REFERENCE = 'heading-reference'

/**
 * The render resolves a reference against the heading text again, so a transform that edits that text first turns each
 * reference a heading resolved into a direct link to the same id.
 */
export function freezeReferences(view: DocumentNode, owner: string): void {
  for (const link of headingReferences(view)) {
    if (link.key === undefined) continue
    delete link.key
    delete link.namespace
    delete link.refForm
    link.data = { ...link.data, [owner]: HEADING_REFERENCE }
  }
}

/** Indents each line of `html` by `depth` levels of two spaces, except the content of a `<pre>`. */
export function indentHtml(html: string, depth: number): string {
  const pad = '  '.repeat(depth)
  let pre = false
  return html.split('\n').map((line) => {
    const out = pre || line === '' ? line : pad + line
    if (/<pre[\s>]/u.test(line)) pre = true
    if (line.includes('</pre>')) pre = false
    return out
  }).join('\n')
}

/** The display text of each heading id, read before a transform edits the headings. */
export function headingTexts(view: DocumentNode): Map<string, Inline[]> {
  const texts = new Map<string, Inline[]>()
  visitTree(view, (node) => {
    if (node.type !== 'heading') return
    const id = headingId(node)
    if (id !== undefined && !texts.has(id)) texts.set(id, derivedInlines(node.children))
  }, false)
  return texts
}

/**
 * A cross-reference writes the text of its heading (C2-I-096), which the render reads from the edited heading. Each one
 * to a heading in `texts` becomes a direct link with the text from before the edit.
 */
export function freezeCrossReferences(view: DocumentNode, texts: ReadonlyMap<string, Inline[]>): void {
  rewriteTree(view, (node) => {
    if (node.type !== 'xref' || node.namespace !== 'heading' || (node.display !== undefined && node.display !== 'title')) return undefined
    const text = texts.get(node.key)
    if (text === undefined) return undefined
    const link: LinkNode = { type: 'link', href: `#${node.key}`, children: structuredClone(text) }
    if (node.attrs !== undefined) link.attrs = node.attrs
    return [link]
  }, true)
}
