import type { List, ListItem } from '../../ast.js'
import type { OlKind, listHelpers } from '../../parse.js'

export function finishList(
  items: ListItem[],
  loose: boolean,
  shape: {
    firstLineIndex: number
    isOrdered: boolean
    orderedStart: number
    orderedKind: OlKind
    orderedDelim: string
    firstOrdered: ReturnType<typeof helpers.orderedMatch>
    firstMarkerChar: string
  },
  helpers: typeof listHelpers,
): List {
  const { isOrdered, orderedStart, orderedKind, orderedDelim, firstOrdered, firstMarkerChar } = shape
  const { olTypeOf } = helpers
  const list: List = { type: 'list', ordered: isOrdered, tight: !loose, items }
  if (isOrdered) {
    if (orderedStart !== 1) list.start = orderedStart
    const t = olTypeOf(orderedKind)
    if (t) list.olType = t
    // Only the non-default spelling is recorded: the schema calls `.` absent,
    // so writing it would give one document two legal trees (carve#2828).
    if (orderedDelim === ')') list.delim = orderedDelim
    // The bare dot is a spelling, not a dialect: `. a` and `1. a` are the same
    // list, so the tree has to carry which one opened it or the writer must
    // normalize one away (PART 11 §6).
    if (firstOrdered && firstOrdered[2] === '') list.bareMarker = true
  } else if (firstMarkerChar === '*') {
    // As above: absence spells the default `-` (carve#2828).
    list.bulletChar = firstMarkerChar
  }
  return list
}
