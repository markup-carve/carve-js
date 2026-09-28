import type { Image, Link } from './ast.js'

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
  if (destination === '') return node
  // The nonempty check establishes the destination invariant at this boundary.
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
