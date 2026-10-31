import type { Figure, InlineNode } from '../../ast.js'

// A reference image binds its caption only once it resolves; an unresolved one
// gives the caption slot back as text in its paragraph (PART 2, CARVE-P2-021).
const unboundCaptions = new WeakMap<Figure, InlineNode[]>()

export function recordUnboundCaption(figure: Figure, paragraph: InlineNode[]): void {
  unboundCaptions.set(figure, paragraph)
}

export function unboundCaptionParagraph(figure: Figure): InlineNode[] | undefined {
  return unboundCaptions.get(figure)
}
