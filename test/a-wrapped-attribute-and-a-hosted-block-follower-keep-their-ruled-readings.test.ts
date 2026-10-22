import { describe, it, expect } from 'vitest'
import { carveToHtml, lintCarve } from '../src/index.js'

const flat = (html: string): string => html.split('\n').map((line) => line.trim()).join('')

// markup-carve/carve#3421 rulings 1 and 3 (22 October), which carve-js already followed.
describe('ruled readings of carve#3421 that carve-js already gave', () => {
  it('reads a wrapped attribute whose closer sits below the column like the one-line form', () => {
    const source = '- a\n  {.c\n}\npara\n'
    expect(flat(carveToHtml(source))).toBe(flat(carveToHtml('- a\n  {.c}\npara\n')))
    expect(flat(carveToHtml(source))).toBe('<ul><li>a</li></ul><p>para</p>')
    expect(lintCarve(source).map((warning) => warning.rule)).toContain('unattached-block-attribute')
  })

  const hosted: Array<[string, string]> = [
    ['> - > +\n# h\n', '<blockquote><ul><li><blockquote><h1 id="h">h</h1></blockquote></li></ul></blockquote>'],
    ['> - > +\n| c |\n', '<blockquote><ul><li><blockquote><table><tbody><tr><td>c</td></tr></tbody></table></blockquote></li></ul></blockquote>'],
    ['> - > +\npara\n', '<blockquote><ul><li><blockquote><p>para</p></blockquote></li></ul></blockquote>'],
  ]
  for (const [source, html] of hosted) {
    it(`attaches the unprefixed column-0 block of ${JSON.stringify(source)} to the inner quote`, () => {
      expect(flat(carveToHtml(source))).toBe(html)
    })
  }

  // CARVE-P9-067, corpus 652 (markup-carve/carve#3534): the list follower is refused in every host.
  for (const source of ['> - > +\n- s\n', '> 1. > +\n1. s\n', '> - - > +\n- s\n']) {
    it(`folds the unprefixed list line of ${JSON.stringify(source)} into the plus`, () => {
      const letter = flat(carveToHtml(source.replace('> +', '> x')))
      expect(flat(carveToHtml(source))).toBe(letter.replace('<p>x', '<p>+'))
    })
  }

  // Corpus 655-3: a sibling item's stacked opener starts a block, so any block attaches (carve#3421 ruling 3).
  const sibling: Array<[string, string]> = [
    ['> - a\n> - > +\n# h\n', '<blockquote><ul><li>a</li><li><blockquote><h1 id="h">h</h1></blockquote></li></ul></blockquote>'],
    ['> 1. a\n>   b\n> 2. > +\n| c |\n', '<blockquote><ol><li>ab</li><li><blockquote><table><tbody><tr><td>c</td></tr></tbody></table></blockquote></li></ol></blockquote>'],
  ]
  for (const [source, html] of sibling) {
    it(`attaches the column-0 block after the sibling item of ${JSON.stringify(source)}`, () => {
      expect(flat(carveToHtml(source))).toBe(html)
    })
  }

  it('keeps an opener inside a div that ended the list as lazy text', () => {
    expect(flat(carveToHtml('> - a\n> ::: code\n> x\n> - > +\n# h\n'))).toBe(
      '<blockquote><ul><li>a</li></ul><div class="code"><p>x- &gt; +</p></div></blockquote><section id="h"><h1>h</h1></section>')
  })

  it('keeps an opener after a paragraph as lazy text', () => {
    expect(flat(carveToHtml('> a\n> - > +\n# h\n'))).toBe('<blockquote><p>a- &gt; +</p></blockquote><section id="h"><h1>h</h1></section>')
  })
})
