import { describe, it, expect } from 'vitest'
import { slugify } from '../src/heading-ids.js'
import { carveToHtml } from '../src/index.js'

/**
 * Strict ASCII heading ids (`slugify(text, {asciiStrict: true})`, surfaced as
 * `asciiHeadingIds: 'strict'`). Unlike best-effort `asciiFold`, which keeps
 * scripts the baked map can't transliterate (Greek / CJK / Arabic / emoji)
 * verbatim, strict drops that residue so the slug is GUARANTEED pure ASCII
 * (`[0-9A-Za-z-]`). A heading made entirely of unmappable script collapses to
 * the `s` fallback. `asciiStrict` implies `asciiFold` (Latin/Cyrillic are still
 * transliterated to letters, not dropped).
 */
describe('strict ASCII heading ids', () => {
  it('transliterates mappable scripts exactly like fold', () => {
    expect(slugify('Café', { asciiStrict: true })).toBe('Cafe')
    expect(slugify('Über uns', { asciiStrict: true })).toBe('Uber-uns')
    expect(slugify('Привет мир', { asciiStrict: true })).toBe('Privet-mir')
  })

  it('drops unmappable residue instead of keeping it', () => {
    // fold keeps these verbatim (see heading-id-ascii.test.ts); strict drops them.
    expect(slugify('Café 日本語', { asciiStrict: true })).toBe('Cafe')
    expect(slugify('A日本B', { asciiStrict: true })).toBe('A-B')
  })

  it('falls back to s when the whole heading is unmappable', () => {
    expect(slugify('日本語', { asciiStrict: true })).toBe('s')
    expect(slugify('Καλημέρα', { asciiStrict: true })).toBe('s')
    expect(slugify('مرحبا', { asciiStrict: true })).toBe('s')
  })

  it('keeps the leading-digit guard after stripping', () => {
    expect(slugify('1 Über', { asciiStrict: true })).toBe('s-1-Uber')
  })

  it('combines with lowercase for a fully lowercase pure-ASCII slug', () => {
    expect(slugify('Über uns', { asciiStrict: true, lowercase: true })).toBe('uber-uns')
    expect(slugify('Café 日本語', { asciiStrict: true, lowercase: true })).toBe('cafe')
  })

  it('guarantees the result matches [0-9A-Za-z-]', () => {
    for (const t of ['Café 日本語', 'Καλημέρα', 'A日本B', '😀 hi', 'Über']) {
      expect(slugify(t, { asciiStrict: true })).toMatch(/^[0-9A-Za-z][0-9A-Za-z-]*$/)
    }
  })

  it('does not change fold / default behavior (regression)', () => {
    expect(slugify('Café 日本語', { asciiFold: true })).toBe('Cafe-日本語')
    expect(slugify('Café 日本語', {})).toBe('Café-日本語')
  })

  it('threads through carveToHtml via the string option value', () => {
    const strict = carveToHtml('# Café 日本語\n', { asciiHeadingIds: 'strict' })
    expect(strict).toContain('id="Cafe"')

    const fold = carveToHtml('# Café 日本語\n', { asciiHeadingIds: 'fold' })
    expect(fold).toContain('id="Cafe-日本語"')

    const foldTrue = carveToHtml('# Café 日本語\n', { asciiHeadingIds: true })
    expect(foldTrue).toContain('id="Cafe-日本語"')
  })
})
