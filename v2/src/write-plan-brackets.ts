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
  if (kind !== TEXT && kind !== OPEN && kind !== CLOSE) return false
  return kind !== TEXT || (escaped[at] === 0 && leaf.kinds[at - 1] !== ESCAPE)
}

/** Whether the text pair at `[opener, closer]` reads as literal text. */
function literalPair(leaf: Leaf, opener: number, closer: number, hasKeys: boolean): boolean {
  if (hasKeys || leaf.codes[opener + 1] === 94) return false
  const next = closer + 1 < leaf.codes.length ? String.fromCharCode(leaf.codes[closer + 1]!) : ''
  return next === '' || !FOLLOWERS.includes(next)
}

export function checkBrackets(leaf: Leaf, escaped: Uint8Array, hasKeys: boolean): void {
  const openers: number[] = []
  const codes = leaf.codes
  for (let at = 0; at < codes.length && leaf.undecided === null; at++) {
    const value = codes[at]
    if ((value !== OPENING && value !== CLOSING) || !isBracket(leaf, at, escaped)) continue
    leaf.cursor = at
    if (value === OPENING) {
      openers.push(at)
      continue
    }
    const opener = openers.pop()
    if (opener === undefined) continue
    const textOpener = leaf.kinds[opener] === TEXT
    if (textOpener !== (leaf.kinds[at] === TEXT)) return undecide(leaf, 'bracket pair')
    if (textOpener && !literalPair(leaf, opener, at, hasKeys)) return undecide(leaf, 'bracket pair')
  }
}
