// C2-W-094: the brackets of a planned leaf, paired the way the reader pairs them (C2-I-006). A pair
// of text brackets is literal where the closing bracket starts no destination, reference, attribute
// block or definition and its label can name no reference; every other pair is left to the repair.
import { CLOSE, ESCAPE, type Leaf, OPEN, TEXT, undecide } from './write-plan-model.ts'

const OPENING = 91
const CLOSING = 93
// `(` destination, `[` reference, `{` attribute block, `:` definition (C2-I-064, C2-I-066, C2-I-072, C2-B-081).
const FOLLOWERS = '([{:'

function isBracket(leaf: Leaf, at: number, escaped: Uint8Array): boolean {
  const kind = leaf.kinds[at]
  if ((kind !== TEXT && kind !== OPEN && kind !== CLOSE) || leaf.opaque?.[at] === 1) return false
  return kind !== TEXT || (escaped[at] === 0 && leaf.kinds[at - 1] !== ESCAPE)
}

/** Whether the text unit `at` is read by the reader, not escaped. */
function isReadText(leaf: Leaf, at: number, escaped: Uint8Array): boolean {
  return leaf.kinds[at] === TEXT && escaped[at] === 0 && leaf.kinds[at - 1] !== ESCAPE
}

const LITERAL = 0
const ESCAPE_OPENER = 1
const NO_DECISION = 2

/**
 * C2-I-076: whether a reference label that starts at `at` ends at a closing bracket that no backslash escapes.
 * A comment may end the line first, so a `%` leaves the pair to the repair.
 */
function labelEnd(leaf: Leaf, at: number): number {
  for (let unit = at; unit < leaf.codes.length; unit++) {
    const value = leaf.codes[unit]
    if (value === 37) return NO_DECISION
    if (value === CLOSING && leaf.kinds[unit - 1] !== ESCAPE) return ESCAPE_OPENER
  }
  return LITERAL
}

/**
 * How the text pair at `[opener, closer]` reads: literal, or a construct whose opener takes the backslash (C2-W-090),
 * which is an inline footnote (C2-I-089) or a full or collapsed reference (C2-I-072, C2-I-075). A link tail, an
 * attribute block, a definition, a footnote reference or a shortcut is left to the repair.
 */
function pairReading(leaf: Leaf, opener: number, closer: number, hasKeys: boolean, escaped: Uint8Array): number {
  if (hasKeys || leaf.codes[opener + 1] === 94) return NO_DECISION
  if (leaf.codes[opener - 1] === 94 && isReadText(leaf, opener - 1, escaped)) return ESCAPE_OPENER
  const next = closer + 1 < leaf.codes.length ? String.fromCharCode(leaf.codes[closer + 1]!) : ''
  if (next === '[' && isReadText(leaf, closer + 1, escaped)) return closer === opener + 1 ? NO_DECISION : labelEnd(leaf, closer + 2)
  return next === '' || !FOLLOWERS.includes(next) ? LITERAL : NO_DECISION
}

interface Scan {
  leaf: Leaf
  escaped: Uint8Array
  openers: number[]
  hasKeys: boolean
}

/** Pairs the closing bracket at `at` with the nearest opener and decides the pair. */
function closePair(scan: Scan, at: number): void {
  const { leaf, openers } = scan
  const opener = openers.pop()
  if (opener === undefined) return
  const textOpener = leaf.kinds[opener] === TEXT
  if (textOpener !== (leaf.kinds[at] === TEXT)) return undecide(leaf, 'bracket pair')
  if (!textOpener) return
  const reading = pairReading(leaf, opener, at, scan.hasKeys, scan.escaped)
  // With an opener left below it, the closing bracket would pair with that one once this opener is escaped.
  if (reading === NO_DECISION || (reading === ESCAPE_OPENER && openers.length > 0)) return undecide(leaf, 'bracket pair')
  if (reading === ESCAPE_OPENER) scan.escaped[opener] = 1
  // C2-I-094: a closed inline extension forms whatever follows it; its colon takes the backslash (C2-W-090), and
  // the pair it leaves is read as any other.
  const colon = leaf.extensions.get(opener)
  if (colon === undefined) return
  // C2-W-125: the backslash may turn a quote before the colon; the procedure then escapes the bracket.
  if (colon > 0 && leaf.kinds[colon - 1] !== TEXT) return undecide(leaf, 'extension')
  scan.escaped[colon] = 1
}

export function checkBrackets(leaf: Leaf, escaped: Uint8Array, hasKeys: boolean): void {
  const scan: Scan = { leaf, escaped, openers: [], hasKeys }
  const codes = leaf.codes
  for (let at = 0; at < codes.length && leaf.undecided === null; at++) {
    const value = codes[at]
    if ((value !== OPENING && value !== CLOSING) || !isBracket(leaf, at, escaped)) continue
    leaf.cursor = at
    if (value === OPENING) scan.openers.push(at)
    else closePair(scan, at)
  }
}
