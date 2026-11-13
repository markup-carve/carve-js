// The generated id of a heading (C2-H-022, CARVE-P2-004): the slug of its plain text.
import { type HeadingIds } from './options.ts'

// The glyphs smart typography writes, back to their source, so an id does not depend on presentation.
const SMART_TO_ASCII = new Map([
  ['↔', '<-->'], ['™', '(tm)'], ['…', '...'], ['→', '-->'], ['←', '<--'], ['⇔', '<=>'], ['⇒', '==>'], ['⇐', '<=='],
  ['≤', '<='], ['≥', '>='], ['≠', '!='], ['±', '+-'], ['–', '-'], ['—', '-'], ['‘', "'"], ['’', "'"], ['“', '"'],
  ['”', '"'], ['„', '"'], ['‚', "'"], ['«', '"'], ['»', '"'], ['‟', '"'], ['‛', "'"],
])

// Letters that a canonical decomposition does not reduce to ASCII. The table of the `ascii` value is host-defined.
const FOLDS = new Map([
  ['ß', 'ss'], ['ẞ', 'SS'], ['æ', 'ae'], ['Æ', 'AE'], ['ø', 'o'], ['Ø', 'O'], ['œ', 'oe'], ['Œ', 'OE'], ['đ', 'd'],
  ['Đ', 'D'], ['ł', 'l'], ['Ł', 'L'], ['þ', 'th'], ['Þ', 'Th'], ['ð', 'd'], ['Ð', 'D'], ['ı', 'i'],
])

const ASCII_END = 0x80
const COMBINING_START = 0x300
const COMBINING_END = 0x36f

// Bidi controls and zero-width characters never reach an id.
function isInvisible(code: number): boolean {
  return (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || code === 0x200b || code === 0x200c ||
    code === 0x200d || code === 0x2060 || code === 0xfeff || code === 0xad
}

function isAsciiAlphanumeric(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

/** Each run of ASCII characters that are no letter and no digit becomes one hyphen; the ends are trimmed. */
function slugRun(text: string, keepsOthers: boolean): string {
  let out = ''
  let pending = false
  for (const char of text) {
    const code = char.codePointAt(0)!
    if (isAsciiAlphanumeric(code) || (keepsOthers && code >= ASCII_END)) {
      if (pending && out !== '') out += '-'
      pending = false
      out += char
    } else {
      pending = true
    }
  }
  return out
}

function replaceEach(text: string, table: ReadonlyMap<string, string>, skipInvisible: boolean): string {
  let out = ''
  for (const char of text) {
    if (skipInvisible && isInvisible(char.codePointAt(0)!)) continue
    out += table.get(char) ?? char
  }
  return out
}

/** Letters with a diacritic lose it, and the letters of FOLDS get their ASCII spelling. */
function transliterate(text: string): string {
  let out = ''
  for (const char of replaceEach(text, FOLDS, false).normalize('NFD')) {
    const code = char.codePointAt(0)!
    if (code < COMBINING_START || code > COMBINING_END) out += char
  }
  return out
}

function startsWithNumber(slug: string): boolean {
  return /^\p{N}/u.test(slug)
}

/** The slug of `text` under a value of `headingIds` other than `off`. Duplicates are not handled here. */
export function slugify(text: string, mode: HeadingIds): string {
  let slug = slugRun(replaceEach(text.normalize('NFC'), SMART_TO_ASCII, true), true)
  if (mode === 'ascii') slug = slugRun(transliterate(slug), false)
  if (mode === 'lower' || mode === 'ascii') {
    // Per code point, so no mapping that depends on context applies.
    let lower = ''
    for (const char of slug) lower += char.toLowerCase()
    slug = lower
  }
  // A leading number is a valid id and an invalid CSS selector.
  if (startsWithNumber(slug)) slug = `s-${slug}`
  return slug === '' ? 's' : slug
}
