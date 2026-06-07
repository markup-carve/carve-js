import { describe, it, expect } from 'vitest'
import { slugify } from '../src/heading-ids.js'

/**
 * Opt-in ASCII-safety fold on heading-id slugs (`slugify(text, true)`,
 * surfaced as the `asciiHeadingIds` parse option). Ported from djot-php
 * #183. The baked Unicode->ASCII map covers Latin / IPA / combining
 * marks / Cyrillic / Latin-Extended-Additional / punctuation / super-
 * and sub-script / currency / letterlike ranges. Greek is deliberately
 * excluded (context-sensitive in ICU), and CJK / Arabic are not in the
 * deterministic map either - those scripts pass through unchanged and
 * authors can attach an explicit `{#id}` for a share-safe slug.
 *
 * The default (no fold) keeps non-ASCII verbatim and lowercases; see
 * heading-ids.test.ts. These tests pin only the fold path.
 */
describe('heading id transliteration (opt-in ASCII safety)', () => {
  it('transliterates Latin diacritics', () => {
    expect(slugify('Café', true)).toBe('cafe')
    expect(slugify('Über uns', true)).toBe('uber-uns')
    expect(slugify('résumé', true)).toBe('resume')
    expect(slugify('Crème brûlée', true)).toBe('creme-brulee')
  })

  it('transliterates Cyrillic to Latin', () => {
    expect(slugify('Привет мир', true)).toBe('privet-mir')
  })

  it('transliterates smart punctuation as content', () => {
    // ’ (U+2019) maps to an ASCII apostrophe, then the #393 run rule turns
    // that non-alnum run into a single dash (same as a literal "Bob's").
    expect(slugify('Bob’s Guide', true)).toBe('bob-s-guide')
    // en-dash, em-dash, ellipsis become ASCII content
    expect(slugify('Yes — no … maybe', true)).toBe('yes-no-maybe')
  })

  it('keeps unmapped scripts (Greek / CJK / Arabic) verbatim, lowercased', () => {
    // Greek is intentionally excluded — context-sensitive ICU translit.
    expect(slugify('Καλημέρα', true)).toBe('καλημέρα')
    expect(slugify('日本語の見出し', true)).toBe('日本語の見出し')
    expect(slugify('مرحبا', true)).toBe('مرحبا')
  })

  it('digit-leading slug gets the s- prefix after translit', () => {
    expect(slugify('2024 Recap', true)).toBe('s-2024-recap')
  })

  it('empty after translit + normalize falls back to s', () => {
    expect(slugify('---', true)).toBe('s')
    expect(slugify('"…"', true)).toBe('s')
  })

  it('plain ASCII heading text is unaffected by the fold', () => {
    expect(slugify('Getting Started', true)).toBe('getting-started')
    expect(slugify('API v2', true)).toBe('api-v2')
  })

  it('NFC-normalizes so decomposed inputs slug identically', () => {
    // `r e ́ s u m e ́` (NFD) must produce the same slug as
    // `r é s u m é` (NFC). Without NFC the combining acute is treated
    // as non-letter/digit and would split the word.
    const nfc = slugify('résumé', true)
    const nfd = slugify('résumé', true)
    expect(nfd).toBe(nfc)
    expect(nfc).toBe('resume')
  })
})
