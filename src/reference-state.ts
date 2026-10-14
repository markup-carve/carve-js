import type { Document, Image, Link } from './ast.js'
import { normalizeRefLabel } from './label-key.js'

const resolvedEmptyReferences = new WeakSet<Link | Image>()

/** A matching empty definition is meaningful even though the destination is empty. */
export function isResolvedEmptyReference(node: Link | Image): boolean {
  return resolvedEmptyReferences.has(node)
}

/** Restore the runtime resolution bit after whole-document JSON decoding. */
export function hydrateResolvedEmptyReferences(document: Document): void {
  const definitions = new Map<string, string>()
  for (const child of document.children) {
    if (child.type === 'link_reference_definition') {
      definitions.set(normalizeRefLabel(child.label), child.href)
    }
  }
  const stack: unknown[] = [document]
  while (stack.length > 0) {
    const value = stack.pop()
    if (Array.isArray(value)) {
      for (const child of value) stack.push(child)
      continue
    }
    if (value === null || typeof value !== 'object') continue
    const node = value as Record<string, unknown>
    if ((node.type === 'link' || node.type === 'image') && typeof node.ref === 'string') {
      const destination = node.type === 'link' ? node.href : node.src
      const resolved = destination === '' && !/[\r\n]/.test(node.ref) &&
        definitions.has(normalizeRefLabel(node.ref)) &&
        definitions.get(normalizeRefLabel(node.ref)) === ''
      if (resolved) resolvedEmptyReferences.add(value as Link | Image)
      else resolvedEmptyReferences.delete(value as Link | Image)
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== 'pos' && key !== 'attrs') stack.push(child)
    }
  }
}

/** Parser placeholders retain the authored label until a destination is found. */
export type UnresolvedLink = Link & { href: ''; ref: string }
export type UnresolvedImage = Image & { src: ''; ref: string }
export type UnresolvedReference = UnresolvedLink | UnresolvedImage

declare const destinationBrand: unique symbol
type ReferenceDestination = string & { readonly [destinationBrand]: true }
export type ResolvedLink = Link & { href: ReferenceDestination; ref: string }
export type ResolvedImage = Image & { src: ReferenceDestination; ref: string }

/** Resolve in place, preserving node identity, source spelling and positions. */
export function resolveReferenceDestination(node: UnresolvedLink, destination: string): ResolvedLink | UnresolvedLink
export function resolveReferenceDestination(node: UnresolvedImage, destination: string): ResolvedImage | UnresolvedImage
export function resolveReferenceDestination(
  node: UnresolvedReference,
  destination: string,
): ResolvedLink | ResolvedImage | UnresolvedReference {
  if (destination === '') resolvedEmptyReferences.add(node)
  else resolvedEmptyReferences.delete(node)
  const resolved = destination as ReferenceDestination
  if (node.type === 'link') {
    const link: Link & { ref: string } = node
    link.href = resolved
    return link as ResolvedLink
  }
  const image: Image & { ref: string } = node
  image.src = resolved
  return image as ResolvedImage
}
