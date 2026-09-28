import type { Attrs, InlineNode } from './ast.js'
import type { LinkDef } from './inline-resolution.js'
import { mergeAttrs } from './attribute-merge.js'
import { normalizeRefLabel } from './label-key.js'
import { resolveReferenceDestination, type UnresolvedReference, type UnresolvedLink, type UnresolvedImage, type ResolvedLink, type ResolvedImage } from './reference-state.js'

/** Resolve explicit definitions; unresolved links remain eligible for heading lookup. */
export function applyReferenceDefinition(node: UnresolvedReference, defs: ReadonlyMap<string, LinkDef>): UnresolvedReference | ResolvedLink | ResolvedImage {
  const definition = /[\r\n]/.test(node.ref) ? undefined : defs.get(normalizeRefLabel(node.ref))
  if (!definition) return node
  const resolved = node.type === 'link'
    ? resolveReferenceDestination(node, definition.href)
    : resolveReferenceDestination(node, definition.href)
  if (definition.title !== undefined) resolved.title = definition.title
  // Definition attributes precede use-site attributes under §15 A3.
  if (definition.attrs) resolved.attrs = mergeAttrs(definition.attrs, resolved.attrs ?? {})
  return resolved
}

/** Preserve the authored source, including consumed attributes, on the placeholder. */
export function referenceLink(ref: string, rawRef: string, children: InlineNode[], attrs?: Attrs): UnresolvedLink {
  const node: UnresolvedLink = { type: 'link', href: '', children, ref }
  node.rawRef = rawRef
  if (attrs) node.attrs = attrs
  return node
}

export function referenceImage(ref: string, rawRef: string, alt: string, attrs?: Attrs): UnresolvedImage {
  const node: UnresolvedImage = { type: 'image', src: '', alt, ref }
  node.rawRef = rawRef
  if (attrs) node.attrs = attrs
  return node
}
