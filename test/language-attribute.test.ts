import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

const html = (src: string) => carveToHtml(src + '\n').trim()

/**
 * `{:TAG}` is exact sugar for `lang=TAG`, and `{:}` for `lang=""` - an explicit
 * "the language here is unknown", which stops inheritance from a surrounding
 * language in a way that omitting the attribute does not. It desugars during
 * attribute parsing, so there is no new AST node and no new field.
 *
 * Draft for markup-carve/carve#1114; the spec side is markup-carve/carve#1115.
 */
describe('the {:TAG} language attribute', () => {
  it.each([
    ['{:fr}', '<p><span lang="fr">x</span></p>'],
    ['{:de-CH}', '<p><span lang="de-CH">x</span></p>'],
    ['{:sr-Latn-RS}', '<p><span lang="sr-Latn-RS">x</span></p>'],
    ['{:x-private}', '<p><span lang="x-private">x</span></p>'],
  ])('%s desugars to a lang key/value', (attr, expected) => {
    expect(html(`[x]${attr}`)).toBe(expected)
  })

  it('the empty form declares the language explicitly unknown', () => {
    expect(html('[x]{:}')).toBe('<p><span lang="">x</span></p>')
  })

  it('is the same attribute as the long form, and merges last-wins', () => {
    expect(html('[x]{:fr}')).toBe(html('[x]{lang=fr}'))
    expect(html('[x]{lang=de :fr}')).toBe('<p><span lang="fr">x</span></p>')
  })

  it('mixes with the other attribute forms and keeps source order', () => {
    expect(html('[x]{#id :fr .cls}')).toBe('<p><span id="id" lang="fr" class="cls">x</span></p>')
  })

  /**
   * The structural envelope only - parsing must not depend on the IANA
   * registry. A candidate outside it is not partly consumed: the whole block
   * stays literal (PART 9 section 14).
   */
  it.each([
    ['{:tada:}', 'the deferred braced-symbol spelling'],
    ['{:en_US}', 'an underscore is not a subtag separator'],
    ['{:en--GB}', 'an empty subtag'],
    ['{:-en}', 'a leading hyphen'],
    ['{:en-}', 'a trailing hyphen'],
    ['{:français}', 'a non-ASCII subtag'],
    ['{:abcdefghi}', 'a subtag longer than eight characters'],
  ])('%s stays literal (%s)', (attr) => {
    // Asserted as "forms no span" rather than as an exact string: the literal
    // text is still inline content, so smart typography reaches it and `--`
    // renders as an en dash. The property under test is that the block is not
    // an attribute block, not how its text is typeset.
    const out = html(`[x]${attr}`)
    expect(out).not.toContain('<span')
    expect(out).not.toContain('lang=')
  })

  /**
   * BOUND, not proof: an attribute name cannot start with `:`, so a colon
   * INSIDE a payload is still invalid and the block still stays literal. This
   * passes with or without the change and is here so a fix cannot pass by
   * admitting a colon anywhere.
   */
  it('a colon that is not at a token boundary is still invalid', () => {
    expect(html('[x]{a:b}')).toBe('<p>[x]{a:b}</p>')
  })

  /**
   * BOUND: the long form and a plain span are untouched by this change.
   */
  it('leaves the long form and an ordinary span alone', () => {
    expect(html('[x]{lang=fr}')).toBe('<p><span lang="fr">x</span></p>')
    expect(html('[x]{.c}')).toBe('<p><span class="c">x</span></p>')
  })

  it('uses the shorthand as the canonical Carve spelling', () => {
    expect(carveToCarve('[x]{lang=fr}\n')).toBe('[x]{:fr}\n')
    expect(carveToCarve('[x]{lang=""}\n')).toBe('[x]{:}\n')
    expect(carveToCarve('[x]{:fr lang=de}\n')).toBe('[x]{:de}\n')
    expect(carveToCarve('[x]{lang=en_US}\n')).toBe('[x]{lang=en_US}\n')
  })

  it('has the same semantic AST as the long form', () => {
    const semantic = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(semantic)
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).filter(([key]) => key !== 'pos' && key !== 'srcByteLength').map(([key, item]) => [key, semantic(item)]),
        )
      }
      return value
    }
    const short = semantic(parse('[x]{:fr}\n'))
    const long = semantic(parse('[x]{lang=fr}\n'))
    expect(short).toEqual(long)
  })

  it('takes no padding after the sigil', () => {
    expect(html('[x]{: fr}')).toBe('<p><span lang="" fr="">x</span></p>')
  })
})
