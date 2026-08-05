/*
 * Trim whitespace but keep NBSP, in time linear in the string's length.
 *
 * Every non-HTML target needs this trim: NBSP is content the author wrote (a
 * `\ ` escape or a `:nbsp:` symbol), so `String.prototype.trim` would eat it.
 * Each target had its own copy of
 *
 *     text.replace(/^[^\S\u00a0]+|[^\S\u00a0]+$/g, '')
 *
 * which is correct and superlinear. `[^\S\u00a0]+$` is a whitespace run
 * ANCHORED AT THE END, so the engine retries it from position after position,
 * and every interior run of whitespace it meets is scanned again. On a string
 * carrying interior indentation the cost grows with (length x run length)
 * rather than with length.
 *
 * That is invisible until something feeds it a long, deeply indented string.
 * `renderMarkdown` does: it re-indents each list level by rendering the whole
 * subtree and trimming it, so a list ladder of depth N is trimmed N times, and
 * the string it trims is itself O(N^2) characters of indentation. Depth 50 took
 * 6.4 seconds and depth 80 did not return inside a minute, on a document well
 * inside the parse cap of 200 (carve-js#701).
 *
 * ONE COPY, deliberately, where there were three. The trim is subtle in exactly
 * the way that drifts: which characters count, and that NBSP does not.
 */

/**
 * Whether the code unit at `index` is whitespace this trim may remove.
 *
 * `[^\S ]` is `\s` MINUS NBSP - so this must agree with `\s` on every
 * character except U+00A0, including the Unicode spaces and U+FEFF that are
 * easy to forget. ASCII is answered arithmetically because that is the whole
 * input in practice; anything above it defers to the regex engine rather than
 * to a hand-written list that would be wrong for U+2028 or U+3000.
 */
function isTrimmable(text: string, index: number): boolean {
  const code = text.charCodeAt(index)
  if (code === 0x00a0) return false
  if (code === 0x20 || (code >= 0x09 && code <= 0x0d)) return true
  if (code < 0x80) return false
  return /\s/.test(text[index] as string)
}

/**
 * `text` without leading or trailing whitespace, NBSP excepted.
 *
 * Returns `text` itself when there is nothing to trim, so the common case
 * allocates nothing.
 */
export function trimNonNbsp(text: string): string {
  let start = 0
  let end = text.length
  while (start < end && isTrimmable(text, start)) start++
  while (end > start && isTrimmable(text, end - 1)) end--
  if (start === 0 && end === text.length) return text

  return text.slice(start, end)
}

/** `trimNonNbsp`, trailing end only. */
export function trimEndNonNbsp(text: string): string {
  let end = text.length
  while (end > 0 && isTrimmable(text, end - 1)) end--
  if (end === text.length) return text

  return text.slice(0, end)
}

/** `trimNonNbsp`, leading end only. */
export function trimStartNonNbsp(text: string): string {
  let start = 0
  while (start < text.length && isTrimmable(text, start)) start++
  if (start === 0) return text

  return text.slice(start)
}
