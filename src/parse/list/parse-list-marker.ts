import { Lexer, indentColumns, isBlankLine } from '../parse-lexer.js'
import type { OlKind, listHelpers } from '../../parse.js'

export function classifyList(lexer: Lexer, helpers: typeof listHelpers): {
  firstLineIndex: number
  baseIndent: number
  isTask: boolean
  isOrdered: boolean
  firstMarkerChar: string
  firstOrdered: ReturnType<typeof helpers.orderedMatch>
  orderedDelim: string
  orderedKind: OlKind
  orderedStart: number
} {
  const { extractItemAttr, olKindOf, olStartOf, orderedMatch, taskMatch, unorderedMarkerChar, RE_ORDERED } = helpers
  const first = lexer.peek()!
  const firstLineIndex = lexer.pos
  const baseIndent = indentColumns(first)
  // Classify on the marker after stripping any abutting `{...}` attribute block.
  const firstTerminatorFree = lexer.lineTerminatorFree(lexer.pos)
  const firstAttr = extractItemAttr(first, firstTerminatorFree)
  const firstStripped = firstAttr ? (firstAttr.markerLine ?? firstAttr.stripped) : first
  const isTask = taskMatch(firstStripped, firstTerminatorFree) !== null
  const isOrdered = !isTask && orderedMatch(firstStripped, firstTerminatorFree) !== null
  // A change of unordered marker character (`-` vs `*` vs `+`), or of
  // ordered dialect/delimiter (decimal/alpha/roman, `.` vs `)`), starts a
  // new list (grammar PART 9 §11). The first item fixes the ordered
  // dialect; the second item's marker (if a sibling) tie-breaks an
  // ambiguous single roman letter.
  const firstMarkerChar = isOrdered ? '' : unorderedMarkerChar(firstStripped)
  const firstOrdered = isOrdered ? orderedMatch(firstStripped, firstTerminatorFree)! : null
  const orderedDelim = firstOrdered ? firstOrdered[3]! : ''
  let orderedKind: OlKind = 'dec'
  let orderedStart = 1
  if (firstOrdered) {
    // Tie-break the dialect on the next sibling, looking past blank lines
    // and the first item's own continuation/nested lines (indented deeper
    // than the marker) — `x.` / blank or indented body / `xi.` is still one
    // roman list.
    let k = 1
    let blankRun = 0
    let hardBoundary = false
    for (; lexer.peek(k) !== undefined; k++) {
      const ln = lexer.peek(k)!
      if (isBlankLine(ln)) {
        blankRun++
        continue
      }
      if (indentColumns(ln, baseIndent + 1) <= baseIndent) {
        hardBoundary = blankRun >= 3
        break
      }
      blankRun = 0
    }
    const nextLine = hardBoundary ? undefined : lexer.peek(k)
    const nextStripped =
      nextLine !== undefined
        ? (extractItemAttr(nextLine)?.stripped ?? nextLine)
        : undefined
    const nm =
      nextStripped !== undefined && indentColumns(nextLine!, baseIndent + 1) === baseIndent
        ? RE_ORDERED.exec(nextStripped)
        : null
    orderedKind = olKindOf(firstOrdered[2]!, nm ? nm[2]! : null)
    orderedStart = olStartOf(firstOrdered[2]!, orderedKind)
  }
  return { firstLineIndex, baseIndent, isTask, isOrdered, firstMarkerChar, firstOrdered, orderedDelim, orderedKind, orderedStart }
}
