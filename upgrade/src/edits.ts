/** One change to the source: the span `start` to `end` becomes `text`. */
export interface Edit {
  start: number
  end: number
  text: string
  /** The contract entry that asked for it. */
  entry: string
  /** Order of collection, the last key of the sort. */
  sequence: number
}

function before(a: Edit, b: Edit): number {
  if (a.start !== b.start) return a.start - b.start
  // An insertion stands before a span replaced at the same offset, or the replacement would take it.
  const aInserts = a.start === a.end
  if (aInserts !== (b.start === b.end)) return aInserts ? -1 : 1
  if (a.entry !== b.entry) return a.entry < b.entry ? -1 : 1
  return a.sequence - b.sequence
}

function collide(a: Edit, b: Edit): boolean {
  if (a.start === a.end && b.start === b.end) return false
  if (a.start === a.end) return a.start > b.start && a.start < b.end
  if (b.start === b.end) return b.start > a.start && b.start < a.end
  return a.start < b.end && b.start < a.end
}

/**
 * The edits that apply together, in source order. Two edits collide when their spans share a
 * character, or when one inserts inside the span of the other. The edits are read in source
 * order against the last span kept: of two that collide, the entry with the lower id stays, and
 * the other is left out for good. Two insertions at one offset both apply, the lower entry id
 * first, and both before a span replaced from that offset on.
 */
export function selectEdits(edits: Edit[]): Edit[] {
  const ordered = [...edits].sort(before)
  const dropped = new Set<Edit>()
  // The kept replacement that reaches furthest: kept spans do not overlap, so only it can collide.
  let last: Edit | null = null
  for (const edit of ordered) {
    if (last !== null && collide(edit, last)) {
      if (edit.entry >= last.entry) {
        dropped.add(edit)
        continue
      }
      dropped.add(last)
      last = null
    }
    if (edit.end > edit.start && (last === null || edit.end > last.end)) last = edit
  }
  return ordered.filter((edit) => !dropped.has(edit))
}

/** Applies `edits`, which `selectEdits` ordered, from the end of the text backward. */
export function applyEdits(src: string, edits: Edit[]): string {
  let out = src
  for (let index = edits.length - 1; index >= 0; index--) {
    const edit = edits[index]!
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  }
  return out
}

/** The offset in the text before `edits` of `offset` in the text after them. */
export function offsetBefore(edits: Edit[], offset: number): number {
  let shift = 0
  for (const edit of edits) {
    const start = edit.start + shift
    if (offset < start) break
    if (offset < start + edit.text.length) return edit.start
    shift += edit.text.length - (edit.end - edit.start)
  }
  return offset - shift
}
