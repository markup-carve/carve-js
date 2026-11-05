import type { Position } from '../ast.js'

type WireNode = { type?: unknown; pos?: Position } & Record<string, unknown>

interface Visit {
  node: WireNode
  order: number
  last: number
  footnote: number
  // Extremes over placed descendants, reaching through unplaced ones.
  placedStart: number
  placedEnd: Position | undefined
}

function typedChildren(node: WireNode): WireNode[] {
  const found: WireNode[] = []
  for (const [key, value] of Object.entries(node)) {
    if (key === 'pos' || key === 'attrs' || !Array.isArray(value)) continue
    for (const child of value) {
      if (child !== null && typeof child === 'object' && typeof (child as WireNode).type === 'string') found.push(child as WireNode)
    }
  }
  return found
}

function offsets(pos: Position | undefined): pos is Position & { startOffset: number; endOffset: number } {
  return Number.isInteger(pos?.startOffset) && Number.isInteger(pos?.endOffset)
}

/**
 * A node whose span runs over a `%%` line S1 erased, where that comment is not
 * its descendant, was joined across source the line separates: it omits `pos`,
 * or ends at its last placed content when the line only trails it
 * (CARVE-P12-014, CARVE-P12-022, carve#5136). Read from the tree alone, so a
 * PART 12 round trip reproduces it; a comment in a hoisted footnote is left to
 * the hoisting exemption.
 */
export function omitSpansAcrossErasedLines(root: WireNode): void {
  const visits: Visit[] = []
  const comments: Array<{ start: number; end: number; order: number; footnote: number; documentChild: boolean }> = []
  let counter = 0
  const walk = (node: WireNode, footnote: number, parentType?: unknown): Visit => {
    const visit: Visit = { node, order: counter++, last: 0, footnote, placedStart: -1, placedEnd: undefined }
    if (node.type === 'footnote') visit.footnote = visit.order
    if (node.type === 'comment' && node.block === false && node.form === 'line' && offsets(node.pos)) {
      comments.push({ start: node.pos.startOffset, end: node.pos.endOffset, order: visit.order, footnote,
        documentChild: parentType === 'document' })
    }
    for (const child of typedChildren(node)) {
      const inner = walk(child, visit.footnote, node.type)
      const own = offsets(child.pos) ? child.pos : undefined
      const start = Math.max(own?.startOffset ?? -1, inner.placedStart)
      if (start > visit.placedStart) visit.placedStart = start
      for (const end of [own, inner.placedEnd]) {
        if (end && (visit.placedEnd === undefined || end.endOffset! > visit.placedEnd.endOffset!)) visit.placedEnd = end
      }
    }
    visit.last = counter - 1
    visits.push(visit)
    return visit
  }
  walk(root, -1)
  if (comments.length === 0) return
  comments.sort((a, b) => a.start - b.start)
  for (const visit of visits) {
    const { node } = visit
    if (!offsets(node.pos)) continue
    const { startOffset, endOffset } = node.pos
    let lo = 0
    let hi = comments.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (comments[mid]!.start < startOffset) lo = mid + 1
      else hi = mid
    }
    let trailing: number | undefined
    let middle = false
    for (let at = lo; at < comments.length && comments[at]!.start < endOffset; at++) {
      const comment = comments[at]!
      if (comment.order >= visit.order && comment.order <= visit.last) continue
      if (node.type === 'footnote' && !comment.documentChild) continue
      if (comment.end > endOffset || comment.footnote !== -1 && comment.footnote !== visit.footnote) continue
      if (visit.last === visit.order || visit.placedStart >= comment.end) {
        middle = true
        break
      }
      trailing ??= comment.start
    }
    if (middle) {
      delete node.pos
    } else if (trailing !== undefined && visit.placedEnd && visit.placedEnd.endOffset! <= trailing) {
      const end = visit.placedEnd
      node.pos = { ...node.pos, endLine: end.endLine, endOffset: end.endOffset!,
        ...(end.endColumn === undefined ? {} : { endColumn: end.endColumn }) }
    }
  }
}
