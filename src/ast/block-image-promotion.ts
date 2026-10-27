import type { Image } from '../ast.js'

const promoted = new WeakSet<Image>()

export function markPromotedBlockImage(image: Image): void {
  promoted.add(image)
}

export function isPromotedBlockImage(image: Image): boolean {
  return promoted.has(image)
}
