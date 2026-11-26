// The generated id of a heading (C2-H-022, C2-H-144 to C2-H-148): the slug of its plain text.
import { type HeadingIds } from './options.ts'
import { SLUG_REMOVED, SLUG_REVERSED } from './render-tables.ts'
import { isAsciiAlphanumeric, isNumber } from './unicode.ts'

// Letters that a canonical decomposition does not reduce to ASCII. The table of the `ascii` value is host-defined.
const FOLDS = new Map([
  ['ß', 'ss'], ['ẞ', 'SS'], ['æ', 'ae'], ['Æ', 'AE'], ['ø', 'o'], ['Ø', 'O'], ['œ', 'oe'], ['Œ', 'OE'], ['đ', 'd'],
  ['Đ', 'D'], ['ł', 'l'], ['Ł', 'L'], ['þ', 'th'], ['Þ', 'Th'], ['ð', 'd'], ['Ð', 'D'], ['ı', 'i'],
])

const ASCII_END = 0x80
const COMBINING_START = 0x300
const COMBINING_END = 0x36f

// C2-H-144, C2-H-145: every code point of both lists lies at or above this one; `«` of the reversed list is below the soft hyphen.
const FIRST_CHANGED = Math.min(...SLUG_REMOVED, ...[...SLUG_REVERSED.keys()].map((glyph) => glyph.codePointAt(0)!))

/** C2-H-146: each run of ASCII characters that are no letter and no digit becomes one hyphen; the ends are trimmed. */
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

/** C2-H-144, C2-H-145: drops the invisible characters and writes the glyphs of smart typography as their source. */
function withoutPresentation(text: string): string {
  let out = ''
  for (const char of text) {
    const code = char.codePointAt(0)!
    if (code < FIRST_CHANGED) out += char
    else if (!SLUG_REMOVED.includes(code)) out += SLUG_REVERSED.get(char) ?? char
  }
  return out
}

function replaceEach(text: string, table: ReadonlyMap<string, string>): string {
  let out = ''
  for (const char of text) out += table.get(char) ?? char
  return out
}

/** Letters with a diacritic lose it, and the letters of FOLDS get their ASCII spelling. */
function transliterate(text: string): string {
  let out = ''
  for (const char of replaceEach(text, FOLDS).normalize('NFD')) {
    const code = char.codePointAt(0)!
    if (code < COMBINING_START || code > COMBINING_END) out += char
  }
  // Hangul decomposes into Jamo under NFD. Restore composed syllables after stripping marks.
  return out.normalize('NFC')
}

function startsWithNumber(slug: string): boolean {
  const first = slug.codePointAt(0)
  return first !== undefined && isNumber(first)
}

function isAscii(text: string): boolean {
  for (let at = 0; at < text.length; at++) if (text.charCodeAt(at) >= ASCII_END) return false
  return true
}

/** The slug of `text` under a value of `headingIds` other than `off`. Duplicates are not handled here. */
export function slugify(text: string, mode: HeadingIds): string {
  // ASCII text is in NFC and holds no character of C2-H-144 and C2-H-145.
  let slug = slugRun(isAscii(text) ? text : withoutPresentation(text.normalize('NFC')), true)
  // C2-H-147: `ascii` keeps what the table cannot map; `ascii-strict` makes it a separator.
  if (mode.startsWith('ascii')) slug = slugRun(transliterate(slug), !mode.startsWith('ascii-strict'))
  if (mode === 'lower' || mode.endsWith('-lower')) {
    // C2-H-147: per code point, so no mapping that depends on context applies.
    let lower = ''
    for (const char of slug) lower += char.toLowerCase()
    slug = lower
  }
  // C2-H-148: a leading number is a valid id and an invalid CSS selector.
  if (startsWithNumber(slug)) slug = `s-${slug}`
  return slug === '' ? 's' : slug
}
