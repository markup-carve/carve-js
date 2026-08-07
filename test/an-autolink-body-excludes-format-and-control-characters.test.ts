import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { autolink } from '../src/autolink.js'

/**
 * PART 3 `url_char` is `unicode_url_char - format_char - control_char`
 * (markup-carve/carve#844, measured in markup-carve/carve#860;
 * markup-carve/carve-js#834).
 *
 * Outside ASCII, a `url_char` is any character that is not whitespace, not a
 * format character (General_Category Cf) and not a control character (Cc,
 * which outside ASCII means the C1 block U+0080-U+009F).
 *
 * The CONTROL term is the one that is easy to leave out and impossible to see:
 * `unicode_url_char` means "non-whitespace, non-ASCII", and every C1 character
 * satisfies exactly that - they are Cc, they are not Cf, and only U+0085 is
 * White_Space. A class written as "non-ASCII and not Cf" therefore admits
 * fourteen invisible control characters while excluding every C0 one.
 *
 * Rather than name the handful of codepoints the report did, the cases below
 * sweep each PROPERTY whole: a class can be narrowed to five characters and
 * still be wrong on the ninety that share their reason.
 */

const EXTS = { extensions: [autolink()] }
const hex = (cp: number) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0')

/** Does the ANGLE autolink admit the character, i.e. does the href carry it? */
const angleAdmits = (cp: number): boolean => {
  const ch = String.fromCodePoint(cp)
  const out = carveToHtml('<https://e' + ch + '.com/>')
  return [...out.matchAll(/<a href="([^"]*)"/g)].some((m) => m[1]!.includes(ch))
}

/** The same question for the bare-URL extension, which spells the body twice more. */
const bareAdmits = (cp: number): boolean => {
  const ch = String.fromCodePoint(cp)
  const out = carveToHtml('x https://e' + ch + '.com/ y', EXTS)
  return [...out.matchAll(/<a href="([^"]*)"/g)].some((m) => m[1]!.includes(ch))
}

const C0 = Array.from({ length: 0x20 }, (_, i) => i)
const C1 = Array.from({ length: 0x20 }, (_, i) => 0x80 + i)
/** A spread of Cf: BMP marks, bidi controls, invisible operators, and three astral ones. */
const CF = [
  0x00ad, 0x0600, 0x061c, 0x070f, 0x180e, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b,
  0x202c, 0x202d, 0x202e, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x2066, 0x2067, 0x2068, 0x2069,
  0x206a, 0x206f, 0xfeff, 0xfff9, 0xfffa, 0xfffb, 0x110bd, 0x1d173, 0xe0001,
]
/** Non-ASCII, non-whitespace, neither Cf nor Cc: every one of these IS a `url_char`. */
const ADMITTED = [0x00e9, 0x4e2d, 0x3001, 0x20ac, 0x0661, 0x0301, 0x1f600, 0x00df]

const rejectedBy = (cps: number[]) =>
  cps
    .filter((cp) => angleAdmits(cp) || bareAdmits(cp))
    .map((cp) => `${hex(cp)}${angleAdmits(cp) ? ' angle' : ''}${bareAdmits(cp) ? ' bare' : ''}`)

describe('an autolink body excludes format and control characters', () => {
  it('admits no C0 control character, over the whole block', () => {
    expect(rejectedBy(C0)).toEqual([])
  })

  it('admits no C1 control character, over the whole block', () => {
    // The half a "non-ASCII and not Cf" rule silently keeps.
    expect(rejectedBy(C1)).toEqual([])
  })

  it('admits U+007F either', () => {
    expect(rejectedBy([0x7f])).toEqual([])
  })

  it('admits no format character, BMP or astral', () => {
    // U+FEFF was already out and U+200B / U+180E were in; they belong to one
    // question and now answer it the same way.
    expect(rejectedBy(CF)).toEqual([])
  })

  it('CONTROL still admits every non-ASCII character that is none of the three', () => {
    // Without this the class could be widened to everything and the construct
    // would vanish. An accented letter, CJK, a CJK comma, a currency sign, an
    // Arabic-Indic digit, a combining mark, an emoji, and a letter that is not
    // a letter in the ASCII sense.
    const missing = ADMITTED.filter((cp) => !angleAdmits(cp) || !bareAdmits(cp))
    expect(missing.map(hex)).toEqual([])
  })

  it('CONTROL still admits an IDN host, an accented host and a non-ASCII path', () => {
    expect(carveToHtml('<https://xn--e-uga.com/>')).toContain('href="https://xn--e-uga.com/"')
    expect(carveToHtml('<https://é.com/>')).toContain('href="https://é.com/"')
    expect(carveToHtml('<https://e.com/pâth>')).toContain('href="https://e.com/pâth"')
  })

  it('CONTROL keeps the nine ASCII exclusions out', () => {
    // The clause is spelled as a subtraction from `unicode_url_char` rather
    // than "any non-whitespace, non-control character" precisely so these stay
    // out. `<` and `>` are the delimiters, so they are tested by what the body
    // STOPS at rather than by the absence of a link.
    for (const ch of ['"', '\\', '`', '{', '}', '|', '^']) {
      expect({ ch, links: /<a href/.test(carveToHtml('<https://e' + ch + '.com/>')) }).toEqual({
        ch,
        links: false,
      })
    }
    expect(carveToHtml('<https://e>.com/>')).toContain('href="https://e"')
    expect(carveToHtml('<https://e<.com/>')).not.toContain('<a href')
  })

  it('CONTROL leaves `link_destination` alone: it is a DIFFERENT production', () => {
    // The hard boundary. A format or control character in an inline
    // destination or a reference definition is an ordinary destination
    // character, and narrowing this too is the failure mode to avoid.
    for (const cp of [0x200b, 0xfeff, 0x2060, 0x200e, 0x0001]) {
      const ch = String.fromCodePoint(cp)
      const inline = /<a href="([^"]*)"/.exec(carveToHtml('[t](https://e' + ch + '.com/)'))
      const ref = /<a href="([^"]*)"/.exec(carveToHtml('[t][r]\n\n[r]: https://e' + ch + '.com/'))
      expect({ cp: hex(cp), inline: inline?.[1]!.includes(ch), ref: ref?.[1]!.includes(ch) }).toEqual({
        cp: hex(cp),
        inline: true,
        ref: true,
      })
    }
  })

  it('CONTROL leaves `scheme` ASCII', () => {
    expect(carveToHtml('<héllo://e.com/>')).not.toContain('<a href')
  })

  it('answers the same in the core parser and in the bare-URL extension', () => {
    // The body is spelled once and used three times - the core angle autolink,
    // the extension's run, and the extension's last-character guard. A URL
    // that may not CONTAIN the character must not be able to END with it.
    const href = (src: string) => /href="([^"]*)"/.exec(carveToHtml(src, EXTS))?.[1]
    const at = (cp: number) => href('see https://a.com/b' + String.fromCodePoint(cp) + 'c end')
    expect(at(0x200b)).toBe('https://a.com/b') // Cf
    expect(at(0x0001)).toBe('https://a.com/b') // Cc, C0
    expect(at(0x0090)).toBe('https://a.com/b') // Cc, C1
    expect(href('see https://a.com/b' + String.fromCodePoint(0x200b) + ' end')).toBe(
      'https://a.com/b',
    )
    // CONTROL: the same URL with an admitted non-ASCII character keeps it.
    expect(href('see https://a.com/béc end')).toBe('https://a.com/béc')
  })
})
