// C2-H-208, C2-H-209: the render option `headingShift`, which moves every heading of the render view down.
import { type DocumentNode, forEachSlot, type HeadingNode, type Node, SOURCE_ORDER } from './ast.ts'

export const HEADING_SHIFT_CODE = 'heading-shift-above-6'
const MAX_HEADING_ELEMENT = 6

/** Visits the headings below `document` in document order, the fallbacks and expanded includes among them, until `visit` returns true. */
function eachHeading(document: DocumentNode, visit: (node: HeadingNode) => boolean): void {
  const pending: Node[] = [document]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === 'heading' && visit(node)) return
    const slots: (readonly Node[])[] = []
    forEachSlot(node, (nodes) => { slots.push(nodes) }, SOURCE_ORDER, document.extensions)
    for (let at = slots.length - 1; at >= 0; at--) {
      const nodes = slots[at]!
      for (let child = nodes.length - 1; child >= 0; child--) pending.push(nodes[child]!)
    }
  }
}

/** Adds `shift` to the level of every heading of `document`, in place. */
export function shiftHeadings(document: DocumentNode, shift: number): void {
  eachHeading(document, (node) => {
    node.level += shift
    return false
  })
}

/** The first heading in document order whose level is above 6, the one `heading-shift-above-6` is reported on. */
export function firstAboveSix(document: DocumentNode): HeadingNode | undefined {
  let found: HeadingNode | undefined
  eachHeading(document, (node) => {
    if (node.level > MAX_HEADING_ELEMENT) found = node
    return found !== undefined
  })
  return found
}

export function headingShiftMessage(shift: number): string {
  return `The heading shift of ${shift} raises a heading above level 6: ` +
    'the render writes it as a div with the role heading, the Markdown export at level 6.'
}
