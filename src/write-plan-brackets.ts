// C2-W-094: the brackets of a planned leaf, paired the way the reader pairs them (C2-I-006). A pair
// of text brackets is literal where the closing bracket starts no destination, reference, attribute
// block or definition and its label can name no reference; every other pair is left to the repair.
import { charsText } from './arrays.ts'
import { emptyBlockEnd, emptyMemo, readAttributeBlock } from './attributes.ts'
import { DEPTH_CAP } from './inline-tables.ts'
import { CLOSE, ESCAPE, inNote, type Leaf, OPEN, TEXT, undecide } from './write-plan-model.ts'

const OPENING = 91
const CLOSING = 93
// `(` destination, `[` reference, `{` attribute block (C2-I-064, C2-I-066, C2-I-072).
const FOLLOWERS = '([{'

function isBracket(leaf: Leaf, at: number, escaped: Uint8Array): boolean {
  const kind = leaf.kinds[at]
  if ((kind !== TEXT && kind !== OPEN && kind !== CLOSE) || leaf.opaque?.[at] === 1) return false
  return kind !== TEXT || (escaped[at] === 0 && leaf.kinds[at - 1] !== ESCAPE)
}

/** Whether the text unit `at` is read by the reader, not escaped. */
function isReadText(leaf: Leaf, at: number, escaped: Uint8Array): boolean {
  return leaf.kinds[at] === TEXT && escaped[at] === 0 && leaf.kinds[at - 1] !== ESCAPE
}

/** C2-I-089, C2-I-055: a bare caret of text opens `^[`, unless a bare `{` of text before it makes `{^` of it. */
export function isFootnoteCaret(leaf: Leaf, at: number, escaped: Uint8Array): boolean {
  if (leaf.codes[at] !== 94 || !isReadText(leaf, at, escaped) || inNote(leaf, at)) return false
  return !(leaf.codes[at - 1] === 123 && isReadText(leaf, at - 1, escaped))
}

const LITERAL = 0
const ESCAPE_OPENER = 1
const NO_DECISION = 2

/**
 * C2-I-076: whether a reference label that starts at `at` ends at a closing bracket that no backslash escapes.
 * A comment may end the line first, so a `%` leaves the pair to the repair.
 */
function labelEnd(leaf: Leaf, at: number, full = true): number {
  // C2-I-078: a label whose first character is an at-sign is reserved for citations and is no reference label.
  if (full && leaf.codes[at] === 64) return LITERAL
  let blank = true
  for (let unit = at; unit < leaf.codes.length; unit++) {
    const value = leaf.codes[unit]!
    if (value === 37) return NO_DECISION
    // C2-I-079: a label that holds only spaces, tabs or a line break is none, and the brackets are text.
    if (value === CLOSING && leaf.kinds[unit - 1] !== ESCAPE) return blank && unit > at ? LITERAL : ESCAPE_OPENER
    if (value !== 32 && value !== 9 && value !== 10) blank = false
  }
  return LITERAL
}

/**
 * C2-I-064, C2-I-040: whether the brace at `at` opens an attribute block that makes the pair a span. The block is read
 * by the reader's grammar on the read text from the brace on; text that a node or an escape cuts short is left to
 * the repair.
 */
function braceReading(leaf: Leaf, at: number, escaped: Uint8Array): number {
  let end = at
  while (end < leaf.codes.length && isReadText(leaf, end, escaped)) end++
  const text = charsText(leaf.codes, at, end)
  const forms = readAttributeBlock(text, 0, text.length, emptyMemo(), null) >= 0 || emptyBlockEnd(text, 0, text.length) >= 0
  if (forms) return ESCAPE_OPENER
  return end === leaf.codes.length ? LITERAL : NO_DECISION
}

/** C2-I-072, C2-I-075, C2-I-079: a full reference reads the label behind the pair, a collapsed one the pair's own. */
function referenceReading(leaf: Leaf, opener: number, closer: number): number {
  if (closer === opener + 1) return NO_DECISION
  return leaf.codes[closer + 2] === CLOSING ? labelEnd(leaf, opener + 1, false) : labelEnd(leaf, closer + 2)
}

/**
 * How the text pair at `[opener, closer]` reads: literal, or a construct whose opener takes the backslash (C2-W-090),
 * which is an inline footnote (C2-I-089) or a full or collapsed reference (C2-I-072, C2-I-075). A link tail, an
 * attribute block, a definition, a footnote reference or a shortcut is left to the repair.
 */
function pairReading(scan: Scan, opener: number, closer: number): number {
  const { leaf, escaped } = scan
  if (scan.hasKeys) return NO_DECISION
  if (isFootnoteCaret(leaf, opener - 1, escaped)) return ESCAPE_OPENER
  if (leaf.codes[opener + 1] === 94) return NO_DECISION
  const next = closer + 1 < leaf.codes.length ? String.fromCharCode(leaf.codes[closer + 1]!) : ''
  if (next === '[' && isReadText(leaf, closer + 1, escaped)) return referenceReading(leaf, opener, closer)
  if (next === '{' && isReadText(leaf, closer + 1, escaped)) return braceReading(leaf, closer + 1, escaped)
  // C2-B-081, C2-B-084: a definition or an abbreviation opens only at the start of a paragraph's first line, which the
  // line rules decide with the reader's shapes.
  if (next === ':') return LITERAL
  if (next === '(') return closesOnLine(scan, closer + 2) ? NO_DECISION : LITERAL
  return next === '' || !FOLLOWERS.includes(next) ? LITERAL : NO_DECISION
}

interface Scan {
  leaf: Leaf
  escaped: Uint8Array
  openers: number[]
  hasKeys: boolean
  /** Per unit, whether a `)` follows on its line from it on; built once per leaf so the scan stays linear (C2-W-089). */
  closes: Uint8Array | null
}

/** C2-I-069: whether a `)` follows on the line from `at` on, in any unit; a link tail stands on one line. */
function closesOnLine(scan: Scan, at: number): boolean {
  const codes = scan.leaf.codes
  if (scan.closes === null) {
    const closes = new Uint8Array(codes.length + 1)
    for (let unit = codes.length - 1; unit >= 0; unit--) {
      const value = codes[unit]
      closes[unit] = value === 41 ? 1 : value === 10 ? 0 : (closes[unit + 1] ?? 0)
    }
    scan.closes = closes
  }
  return scan.closes[at] === 1
}

/** Pairs the closing bracket at `at` with the nearest opener and decides the pair. */
function closePair(scan: Scan, at: number): void {
  const { leaf, openers } = scan
  const opener = openers.pop()
  if (opener === undefined) return
  const textOpener = leaf.kinds[opener] === TEXT
  if (textOpener !== (leaf.kinds[at] === TEXT)) return undecide(leaf, 'bracket pair')
  if (!textOpener) return
  const reading = pairReading(scan, opener, at)
  // With an opener left below it, the closing bracket would pair with that one once this opener is escaped.
  if (reading === NO_DECISION || (reading === ESCAPE_OPENER && openers.length > 0)) return undecide(leaf, 'bracket pair')
  if (reading === ESCAPE_OPENER) scan.escaped[keepsBracket(scan, opener, at) ? opener - 1 : opener] = 1
  // C2-I-094: a closed inline extension forms whatever follows it; its colon takes the backslash (C2-W-090), and
  // the pair it leaves is read as any other.
  const colon = leaf.extensions.get(opener)
  if (colon === undefined) return
  // C2-W-125: the backslash may turn a quote before the colon; the procedure then escapes the bracket.
  if (colon > 0 && leaf.kinds[colon - 1] !== TEXT) return undecide(leaf, 'extension')
  scan.escaped[colon] = 1
}

/**
 * C2-I-023, C2-I-024: a line comment that a note's closer ends needs the bracket; there the caret takes the backslash
 * and the pair stays an ordinary bracket.
 */
function keepsBracket(scan: Scan, opener: number, closer: number): boolean {
  const leaf = scan.leaf
  if (!isFootnoteCaret(leaf, opener - 1, scan.escaped)) return false
  const last = leaf.owners[closer - 1]
  // The bracket then pairs as an ordinary one, so nothing glued to its closer may make a construct of it.
  const next = closer + 1 < leaf.codes.length ? String.fromCharCode(leaf.codes[closer + 1]!) : ''
  return last?.type === 'comment' && last.form === 'line' && !FOLLOWERS.includes(next === '' ? ' ' : next)
}

export function checkBrackets(leaf: Leaf, escaped: Uint8Array, hasKeys: boolean): void {
  const scan: Scan = { leaf, escaped, openers: [], hasKeys, closes: null }
  const codes = leaf.codes
  let nodes = 0
  for (let at = 0; at < codes.length && leaf.undecided === null; at++) {
    if (leaf.kinds[at] === OPEN) nodes++
    else if (leaf.kinds[at] === CLOSE) nodes--
    const value = codes[at]
    if ((value !== OPENING && value !== CLOSING) || !isBracket(leaf, at, escaped)) continue
    leaf.cursor = at
    // C2-I-118, C2-B-190: an opening bracket is text where the open nodes and the open brackets of the content reach the
    // cap; no block counts. The open delimiters count too, so the leaf is left to the repair near the cap.
    if (value === OPENING && scan.openers.length + nodes >= DEPTH_CAP) return undecide(leaf, 'depth cap')
    if (value === OPENING) scan.openers.push(at)
    else closePair(scan, at)
  }
  // An unmatched text opener can turn the preceding source-spelled reference into a full reference.
  // Its spelling is an atom here, so the pair scan cannot see that link's own brackets.
  checkSourceLinkBoundary(scan)
}

function checkSourceLinkBoundary(scan: Scan): void {
  const leaf = scan.leaf
  if (leaf.undecided === null && scan.openers.some((at) => followsSourceLink(leaf, at))) undecide(leaf, 'reference boundary')
  // The source of a later bracketed atom can close an unmatched text bracket. Its own source is opaque to this scan,
  // so the repair must test that boundary against the read-back parse.
  if (leaf.undecided === null && scan.openers.length > 0) {
    const first = scan.openers[0]!
    for (let unit = first + 1; unit < leaf.codes.length; unit++) {
      if (leaf.kinds[unit] !== TEXT && leaf.owners[unit]?.type === 'footnote_ref') {
        undecide(leaf, 'bracket atom boundary')
        break
      }
    }
  }
}

function followsSourceLink(leaf: Leaf, at: number): boolean {
  return leaf.kinds[at] === TEXT && at > 0 && leaf.codes[at - 1] === CLOSING && leaf.owners[at - 1]?.type === 'link'
}
