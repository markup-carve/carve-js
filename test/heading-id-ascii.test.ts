import { describe, it, expect } from 'vitest'
import { slugify } from '../src/heading-ids.js'

/**
 * Opt-in ASCII-safety fold on heading-id slugs (`slugify(text, {asciiFold:
 * true})`, surfaced as the `asciiHeadingIds` parse option). Ported from
 * djot-php #183. The baked Unicode->ASCII map covers Latin / IPA /
 * combining marks / Cyrillic / Latin-Extended-Additional / punctuation /
 * super- and sub-script / currency / letterlike ranges. Greek is
 * deliberately excluded (context-sensitive in ICU), and CJK / Arabic are
 * not in the deterministic map either - those scripts pass through
 * unchanged and authors can attach an explicit `{#id}` for a share-safe
 * slug.
 *
 * The fold now PRESERVES case (it is orthogonal to the opt-in `lowercase`
 * transform): `Über` -> `Uber`, not `uber`. There is NO Unicode (NFC)
 * normalization in any path. The default (no fold) keeps non-ASCII verbatim
 * and preserves case; see heading-ids.test.ts. These tests pin the fold
 * path (case kept).
 */
describe('heading id transliteration (opt-in ASCII safety)', () => {
  it('transliterates Latin diacritics, keeping case', () => {
    expect(slugify('Café', { asciiFold: true })).toBe('Cafe')
    expect(slugify('Über uns', { asciiFold: true })).toBe('Uber-uns')
    expect(slugify('résumé', { asciiFold: true })).toBe('resume')
    expect(slugify('Crème brûlée', { asciiFold: true })).toBe('Creme-brulee')
  })

  it('transliterates Cyrillic to Latin, keeping case', () => {
    expect(slugify('Привет мир', { asciiFold: true })).toBe('Privet-mir')
  })

  it('transliterates smart punctuation as content', () => {
    // ’ (U+2019) maps to an ASCII apostrophe, then the #393 run rule turns
    // that non-alnum run into a single dash (same as a literal "Bob's").
    expect(slugify('Bob’s Guide', { asciiFold: true })).toBe('Bob-s-Guide')
    // en-dash, em-dash, ellipsis become ASCII content
    expect(slugify('Yes — no … maybe', { asciiFold: true })).toBe('Yes-no-maybe')
  })

  it('keeps unmapped scripts (Greek / CJK / Arabic) verbatim, case-preserved', () => {
    // Greek is intentionally excluded — context-sensitive ICU translit.
    // Case is preserved (capital Kappa stays capital).
    expect(slugify('Καλημέρα', { asciiFold: true })).toBe('Καλημέρα')
    expect(slugify('日本語の見出し', { asciiFold: true })).toBe('日本語の見出し')
    expect(slugify('مرحبا', { asciiFold: true })).toBe('مرحبا')
  })

  it('digit-leading slug gets the s- prefix after translit', () => {
    expect(slugify('2024 Recap', { asciiFold: true })).toBe('s-2024-Recap')
  })

  it('empty after translit falls back to s', () => {
    expect(slugify('---', { asciiFold: true })).toBe('s')
    expect(slugify('"…"', { asciiFold: true })).toBe('s')
  })

  it('plain ASCII heading text keeps case under the fold', () => {
    expect(slugify('Getting Started', { asciiFold: true })).toBe('Getting-Started')
    expect(slugify('API v2', { asciiFold: true })).toBe('API-v2')
  })

  it('combining asciiFold + lowercase yields fully lowercase ASCII', () => {
    expect(slugify('Über uns', { asciiFold: true, lowercase: true })).toBe('uber-uns')
    expect(slugify('Café', { asciiFold: true, lowercase: true })).toBe('cafe')
  })

  it('does NOT Unicode-normalize: decomposed (NFD) and precomposed (NFC) differ', () => {
    // No NFC step: a precomposed `é` (NFC) folds via the baked map to `e`,
    // but a decomposed base+combining-acute (NFD) keeps the (unmapped)
    // combining mark verbatim, so the two inputs slug differently.
    const nfc = slugify('résumé'.normalize('NFC'), { asciiFold: true })
    const nfd = slugify('résumé'.normalize('NFD'), { asciiFold: true })
    expect(nfc).toBe('resume')
    expect(nfd).not.toBe(nfc)
  })
})
