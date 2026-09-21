/**
 * `link_destination` (grammar PART 3), spelled once for every reader.
 *
 * The inline tail, the reference definition and the fast HTML path are all
 * built from this production, and three spellings of it disagreed about
 * `[a]: a(b` (markup-carve/carve-js#1868).
 */

const RE_DESTINATION_WHITESPACE = /\p{White_Space}/u

/**
 * Read a destination out of a link or image tail, starting at the `(`.
 *
 * A parenthesis inside a destination is balanced against the one that closes
 * the tail, so `[a](x(y)z)` is a whole link rather than a truncated one. This
 * is what djot and CommonMark both do, and URLs that carry parentheses -
 * Wikipedia and MDN produce them constantly - are the reason they do.
 *
 * The scan ends at whitespace, which begins a title, or at a `)` with no
 * opener left to match. A destination that needs either of those characters
 * literally escapes it; the three escapes are the only ones here, so a
 * backslash in front of anything else stays a literal backslash and URLs full
 * of them are unaffected.
 *
 * Returns the raw destination and where the scan stopped, or null when the
 * tail does not open with the parenthesis.
 */
export function scanDestination(tail: string, open = 0): { dest: string; end: number } | null {
  if (tail[open] !== '(') return null
  let dest = ''
  let depth = 0
  let i = open + 1
  for (; i < tail.length; i++) {
    const c = tail[i]!
    if (c === '\\' && (tail[i + 1] === '(' || tail[i + 1] === ')' || tail[i + 1] === '\\')) {
      dest += tail[i + 1]
      i++
      continue
    }
    if (c === '(') depth++
    else if (c === ')') {
      if (depth === 0) break
      depth--
    } else if (RE_DESTINATION_WHITESPACE.test(c)) break
    dest += c
  }
  return { dest, end: i }
}

/**
 * A whole run read as `link_destination`: its value, or null when the run is
 * not one.
 *
 * A reference definition is built from the same production as the inline tail,
 * so `[a]: a(b` is no more a destination than `[t](a(b)` is a link. The run is
 * read by the scan above between a synthetic pair, so there is no second
 * spelling: a run the scan does not consume whole left a parenthesis or a
 * whitespace character behind.
 */
export function linkDestinationValue(run: string): string | null {
  const scanned = scanDestination(`(${run})`)
  if (scanned === null || scanned.end !== run.length + 1 || scanned.dest === '') return null

  return scanned.dest
}
