/**
 * `link_destination` (grammar PART 3), spelled once for every reader.
 *
 * The inline tail, the reference definition and the fast HTML path are all
 * built from this production, and three spellings of it disagreed about
 * `[a]: a(b` (markup-carve/carve-js#1868).
 */

const RE_DESTINATION_WHITESPACE = /\p{White_Space}/u

function isDestinationWhitespace(char: string): boolean {
  const code = char.charCodeAt(0)
  return code <= 32
    ? code === 0 || code === 32 || (code >= 9 && code <= 13)
    : code > 127 && RE_DESTINATION_WHITESPACE.test(char)
}

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
 * tail does not open with the parenthesis, or when whitespace arrives with a
 * `(` still open: `balanced_parens` admits no whitespace, so that run is no
 * destination at all (markup-carve/carve-js#1872).
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
    } else if (isDestinationWhitespace(c)) {
      if (depth > 0) return null
      break
    }
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

export const RE_LINK_REST = /^(?:(?: "((?:[^"\\]|\\[\s\S])*)"| '((?:[^'\\]|\\[\s\S])*)') *)?\)/
export const RE_EMPTY_LINK_REST = /^(?: "((?:[^"\\]|\\[\s\S])*)"| '((?:[^'\\]|\\[\s\S])*)')? *\)/

const RE_LINK_REST_STICKY = new RegExp(RE_LINK_REST.source.slice(1), 'y')
const RE_EMPTY_LINK_REST_STICKY = new RegExp(RE_EMPTY_LINK_REST.source.slice(1), 'y')

/** Complete destination openers, with nested destinations scanned once. */
export function completeDestinationOpeners(text: string): Set<number> {
  return new Set(destinationSlotEnds(text).keys())
}

/** Each complete destination slot's `(`, mapped to the offset after its `)`, in linear time. */
export function destinationSlotEnds(text: string, first = 0): Map<number, number> {
  const stops = new Int32Array(text.length + 1)
  stops[text.length] = text.length
  for (let i = text.length - 1; i >= first; i--) {
    const code = text.charCodeAt(i)
    if (code === 92) {
      const next = text.charCodeAt(i + 1)
      if (next === 92 || next === 40 || next === 41) {
        stops[i] = stops[i + 2]!
        continue
      }
    } else if (code === 40) {
      const close = stops[i + 1]!
      stops[i] = text.charCodeAt(close) === 41 ? stops[close + 1]! : -1
      continue
    } else if (code === 41 || code === 0 || code === 32 || (code >= 9 && code <= 13) ||
      (code > 127 && RE_DESTINATION_WHITESPACE.test(text[i]!))) {
      stops[i] = i
      continue
    }
    stops[i] = stops[i + 1]!
  }
  const found = new Map<number, number>()
  const closes = new Map<number, number>()
  for (let i = text.indexOf('(', first); i !== -1; i = text.indexOf('(', i + 1)) {
    const stop = stops[i + 1]!
    if (stop < i + 1) continue
    const empty = stop === i + 1
    const key = stop * 2 + Number(empty)
    let end = closes.get(key)
    if (end === undefined) {
      const rest = empty ? RE_EMPTY_LINK_REST_STICKY : RE_LINK_REST_STICKY
      rest.lastIndex = stop
      const m = rest.exec(text)
      end = m === null ? -1 : stop + m[0].length
      closes.set(key, end)
    }
    if (end !== -1) found.set(i, end)
  }
  return found
}
