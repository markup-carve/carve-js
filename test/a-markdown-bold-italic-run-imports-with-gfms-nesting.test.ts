import { describe, it, expect } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { carveToCarve, carveToHtml } from '../src/index.js'

/**
 * cmark-gfm 0.29.0.gfm.13 reads `***x***` and `___x___` as `<em><strong>`. Carve's
 * bare `/*` is a two-character token that materializes `strong` OUTSIDE
 * `emphasis` from one run of delimiters, which is normative
 * (`23-ast-foundations.ebnf:380`, `07-inline-rich-text.ebnf:87`), so the spelling
 * the importer writes is what has to change and no renderer does. The braced form
 * is `forced_emphasis` (`07-inline-rich-text.ebnf:102`) holding a bare strong,
 * which is the nesting the source meant (carve-js#2041).
 *
 * The TREE is the reason for the change and the bytes are only the means, so both
 * are asserted. The rendered text is identical either way, which is exactly why a
 * byte assertion alone would not say whether the fix landed.
 *
 * carve-js#2039 already wrote the braced form where the run opens intraword. This
 * extends it to every other position rather than introducing it.
 */
const html = (carve: string, smartTypography: 'glyph' | 'source' = 'glyph'): string =>
  carveToHtml(carve, { smartTypography })
    .replace(/\s+id="[^"]*"/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim()

describe('a Markdown bold-italic run imports as an emphasis around a strong', () => {
  it.each([
    ['***x***\n', '{/*x*/}\n'],
    ['___x___\n', '{/*x*/}\n'],
    // An emphasis whose whole body is a strong is the same construct spelled
    // with two runs, and cmark-gfm reads it the same way.
    ['*__x__*\n', '{/*x*/}\n'],
    ['_**x**_\n', '{/*x*/}\n'],
    ['p ***x*** q\n', 'p {/*x*/} q\n'],
    ['(***x***)\n', '({/*x*/})\n'],
    ['***x y***\n', '{/*x y*/}\n'],
  ])('%s', (markdown, carve) => {
    expect(markdownToCarve(markdown)).toBe(carve)
    // The tree, which is the point: em outside strong, both present.
    expect(html(carve)).toMatch(/<em><strong>/)
    expect(html(carve)).not.toMatch(/<strong><em>/)
    // And the import is a fixed point of this engine's own formatter.
    expect(carveToCarve(carve)).toBe(carve)
  })

  it('agrees with the oracle on the tree, not only on the text', () => {
    // cmark-gfm: <p>p <em><strong>x</strong></em> q</p>
    expect(html(markdownToCarve('p ***x*** q\n'))).toBe('<p>p <em><strong>x</strong></em> q</p>')
  })

  it('reaches every block the importer writes inline text from', () => {
    for (const [markdown, contains] of [
      ['- ***x***\n', '<li>'],
      ['> ***x***\n', '<blockquote>'],
      ['## ***x***\n', '<h2'],
      ['[***x***](/u)\n', '<a '],
      ['| a |\n| - |\n| ***x*** |\n', '<td>'],
    ] as const) {
      const out = html(markdownToCarve(markdown))
      expect(out).toContain(contains)
      expect(out).toMatch(/<em><strong>x<\/strong><\/em>/)
    }
  })

  it('writes the same tree in both typography modes', () => {
    // The axis is awake: the body carries a bare hyphen run, which reaches smart
    // typography, so a reader could see a dash where two hyphens were typed.
    const carve = markdownToCarve('***a -- b***\n')
    for (const mode of ['glyph', 'source'] as const) {
      expect(html(carve, mode)).toMatch(/<em><strong>/)
      expect(html(carve, mode)).not.toMatch(/<strong><em>/)
    }
  })
})

describe('what already held still holds', () => {
  // Controls: each of these passes on BOTH sides of the change.
  it('keeps the BARE form where the source means strong outside emphasis', () => {
    // `**_x_**` is a strong AROUND an emphasis in cmark-gfm, which is what bare
    // `*/x/*` is in Carve. Braced here, the fix would pass its own tests for the
    // wrong reason by making every case em-outside-strong.
    for (const markdown of ['**_x_**\n', '__*x*__\n']) {
      expect(markdownToCarve(markdown)).toBe('*/x/*\n')
      expect(html('*/x/*\n')).toMatch(/<strong><em>x<\/em><\/strong>/)
      expect(html('*/x/*\n')).not.toMatch(/<em><strong>/)
    }
  })

  it('keeps a strong with an emphasis inside part of it bare', () => {
    expect(markdownToCarve('**a *b* c**\n')).toBe('*a /b/ c*\n')
    expect(html('*a /b/ c*\n')).toBe('<p><strong>a <em>b</em> c</strong></p>')
  })

  it('keeps an emphasis with a strong inside part of it bare', () => {
    // The strong does not reach either end, so no slash is glued to a star and
    // the bare form says what the source said.
    expect(markdownToCarve('*a **b** c*\n')).toBe('/a *b* c/\n')
    expect(markdownToCarve('_a __b__ c_\n')).toBe('/a *b* c/\n')
    expect(html('/a *b* c/\n')).toBe('<p><em>a <strong>b</strong> c</em></p>')
  })

  it('does not double-brace the intraword spelling carve-js#2039 already braced', () => {
    expect(markdownToCarve('a***f***b\n')).toBe('a{/*f*/}b\n')
    expect(markdownToCarve('a**f**b\n')).toBe('a{*f*}b\n')
    expect(markdownToCarve('a*f*b\n')).toBe('a{/f/}b\n')
    expect(carveToCarve('a{/*f*/}b\n')).toBe('a{/*f*/}b\n')
  })

  it('leaves a plain emphasis and a plain strong alone', () => {
    expect(markdownToCarve('*x*\n')).toBe('/x/\n')
    expect(markdownToCarve('_x_\n')).toBe('/x/\n')
    expect(markdownToCarve('**x**\n')).toBe('*x*\n')
    expect(markdownToCarve('__x__\n')).toBe('*x*\n')
  })

  it('leaves `2 * 3` and snake_case literal', () => {
    expect(markdownToCarve('2 * 3\n')).toContain('2 ')
    expect(html(markdownToCarve('2 * 3\n'))).not.toContain('<em>')
    expect(html(markdownToCarve('a_b_c\n'))).not.toContain('<em>')
  })
})
