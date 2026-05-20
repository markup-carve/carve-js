import { describe, it, expect } from 'vitest'
import { slugify } from '../src/heading-ids.js'

/**
 * ASCII-safety pass on heading-id slugs (ported from djot-php #183).
 * The baked Unicode->ASCII map covers Latin / IPA / combining marks /
 * Cyrillic / Latin-Extended-Additional / punctuation / super- and
 * sub-script / currency / letterlike ranges. Greek is deliberately
 * excluded (context-sensitive in ICU), and CJK / Arabic are not in the
 * deterministic map either — those scripts pass through unchanged and
 * authors can attach an explicit `{#id}` for a share-safe slug.
 */
describe('heading id transliteration (ASCII safety)', () => {
  it('transliterates Latin diacritics', () => {
    expect(slugify('Café')).toBe('cafe')
    expect(slugify('Über uns')).toBe('uber-uns')
    expect(slugify('résumé')).toBe('resume')
    expect(slugify('Crème brûlée')).toBe('creme-brulee')
  })

  it('transliterates Cyrillic to Latin', () => {
    expect(slugify('Привет мир')).toBe('privet-mir')
  })

  it('transliterates smart punctuation as content', () => {
    // ’ (U+2019) is in the map as an apostrophe → dropped by CSS-unsafe step.
    expect(slugify('Bob’s Guide')).toBe('bobs-guide')
    // ⟨...⟩, en-dash, em-dash, ellipsis become ASCII content
    expect(slugify('Yes — no … maybe')).toBe('yes-no-maybe')
  })

  it('keeps unmapped scripts (Greek / CJK / Arabic) verbatim', () => {
    // Greek is intentionally excluded — context-sensitive ICU translit.
    expect(slugify('Καλημέρα')).toBe('καλημέρα')
    expect(slugify('日本語の見出し')).toBe('日本語の見出し')
    expect(slugify('مرحبا')).toBe('مرحبا')
  })

  it('digit-leading slug gets the section- prefix after translit', () => {
    expect(slugify('2024 Recap')).toBe('section-2024-recap')
  })

  it('empty after translit + normalize falls back to section', () => {
    expect(slugify('---')).toBe('section')
    expect(slugify('"…"')).toBe('section')
  })

  it('explicit ASCII heading text is unaffected', () => {
    expect(slugify('Getting Started')).toBe('getting-started')
    expect(slugify('API v2')).toBe('api-v2')
  })

  it('NFC-normalizes so decomposed inputs slug identically', () => {
    // `r e ́ s u m e ́` (NFD) must produce the same slug as
    // `r é s u m é` (NFC). Without NFC the combining acute is treated
    // as non-letter/digit and would split the word.
    const nfc = slugify('résumé')
    const nfd = slugify('résumé')
    expect(nfd).toBe(nfc)
    expect(nfc).toBe('resume')
  })
})
