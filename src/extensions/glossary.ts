// Glossary: `:term[word]` links a use to its entry in a `::: glossary` description list.
import { type DefinitionTermNode, type DirectiveNode, type DocumentNode, type Inline, type InlineExtensionNode,
  type Node } from '../ast.ts'
import { plainText } from '../ast-text.ts'
import { slugify } from '../slug.ts'
import { type ExtensionBundle, claimDirective, coreInlines, declare, directiveDefinition, freshId, inlineAttributes,
  slotRenderer, viewIds, walkView } from './apparatus.ts'
import { type ExtensionDefinition, type ExtensionRenderer } from './types.ts'

const TERM = 'carve.term'
const GLOSSARY = 'carve.glossary'

/** A use reaches an entry by its exact text after whitespace collapse and NFC, as in 0.1. */
function termKey(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim()
}

export const termExtension: ExtensionDefinition = {
  name: TERM, version: '1', matcher: { form: 'inline', name: 'term' }, props: { href: 'string' },
  slots: { text: { kind: 'inline', optional: true } }, children: 'none',
  transform: (claim) => {
    if (claim.form !== 'inline') return null
    const node: InlineExtensionNode = { type: 'inline_extension', name: TERM, version: '1', children: [],
      fallback: coreInlines(claim.children) }
    if (claim.children.length > 0) node.slots = { text: claim.children }
    return node
  },
}

export const glossaryExtension: ExtensionDefinition = directiveDefinition(GLOSSARY)

function isGlossary(node: Node): node is DirectiveNode {
  return node.type === 'directive' && node.kind === 'glossary'
}

interface Entries { targets: Map<string, string>, ids: Map<Node, string>, taken: Set<string>, slugs: Set<string> }

/** One term: the first term of a slug takes the id, and the first of a key is the target. */
function addTerm(term: DefinitionTermNode, entries: Entries): void {
  const text = plainText(term.children)
  const slug = slugify(text, 'keep-case')
  if (!entries.slugs.has(slug)) {
    entries.slugs.add(slug)
    if (term.attrs?.id === undefined) entries.ids.set(term, freshId(`gloss-${slug}`, entries.taken))
  }
  const id = term.attrs?.id ?? entries.ids.get(term)
  const key = termKey(text)
  if (id !== undefined && !entries.targets.has(key)) entries.targets.set(key, id)
}

/** The entries of every glossary in document order. */
function collectEntries(view: DocumentNode): Entries {
  const entries: Entries = { targets: new Map(), ids: new Map(), taken: viewIds(view), slugs: new Set() }
  walkView(view, (node) => {
    if (!isGlossary(node)) return undefined
    for (const list of node.children) {
      if (list.type !== 'definition_list') continue
      for (const term of list.children) if (term.type === 'definition_term') addTerm(term, entries)
    }
    return undefined
  })
  return entries
}

function glossaryTransform(view: DocumentNode): DocumentNode {
  const { targets, ids } = collectEntries(view)
  walkView(view, (node) => {
    if (node.type !== 'inline_extension' || node.name !== TERM) return undefined
    const target = targets.get(termKey(plainText((node.slots?.['text'] ?? []) as Inline[])))
    if (target !== undefined) node.props = { href: `#${target}` }
    return undefined
  })
  let claimed = false
  walkView(view, (node) => {
    if (!isGlossary(node)) return undefined
    claimed = true
    const body = structuredClone(node)
    for (const [at, list] of node.children.entries()) {
      const copy = body.children[at]
      if (list.type !== 'definition_list' || copy?.type !== 'definition_list') continue
      copy.attrs = { ...copy.attrs, classes: ['glossary', ...copy.attrs?.classes ?? []] }
      for (const [index, term] of list.children.entries()) {
        const id = ids.get(term)
        const target = copy.children[index]
        if (id !== undefined && target !== undefined) target.attrs = { ...target.attrs, id }
      }
    }
    return claimDirective(GLOSSARY, node, [body])
  })
  if (claimed) declare(view, [glossaryExtension])
  return view
}

function renderTerm(node: Parameters<NonNullable<ExtensionRenderer['render']>>[0],
  host: Parameters<NonNullable<ExtensionRenderer['render']>>[1]): string {
  if (node.type !== 'inline_extension') return ''
  const text = host.inlines(node.slots?.['text'] ?? [])
  const href = node.props?.['href']
  // The glossary target wins over an authored `href`, so the link has one.
  if (typeof href === 'string') {
    const attrs = inlineAttributes(node, host, 'term', (key) => key.toLowerCase() === 'href')
    return `<a href="${host.escapeAttribute(href)}"${attrs}>${text}</a>`
  }
  return `<span${inlineAttributes(node, host, 'term', () => false)}>${text}</span>`
}

export const termRenderer: ExtensionRenderer = { version: '1', render: renderTerm, buildTime: renderTerm }
export const glossaryRenderer: ExtensionRenderer = slotRenderer('body')

/** The provisional standard glossary extension. */
export function glossary(): ExtensionBundle {
  return {
    extensions: [termExtension, glossaryExtension],
    renderers: { [TERM]: termRenderer, [GLOSSARY]: glossaryRenderer },
    transforms: [{ name: 'glossary', transform: glossaryTransform }],
  }
}
