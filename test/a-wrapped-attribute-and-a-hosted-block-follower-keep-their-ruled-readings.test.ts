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

  // Ruling 3: after a closed block the stacked opener starts a block, so any block attaches.
  for (const before of ['> # t', '> | a |', '> ```\n> x\n> ```', '> ::: note\n> x\n> :::', '> :::\n> x\n> :::', '> :::: note\n> x\n> ::::', '> ::: a\n> ::: b\n> x\n> :::', '> ***', '> {.c}', '> %% c', '> [r]: /u']) {
    it(`attaches a heading after ${JSON.stringify(before)} and a stacked quote plus`, () => {
      expect(flat(carveToHtml(`${before}\n> - > +\n# h\n`))).toContain('<li><blockquote><h1 id="h">h</h1></blockquote></li>')
    })
  }

  for (const before of ['> ```\n> x', '> ::: note\n> x', '> :::\n> x', '> > q']) {
    it(`keeps the opener after ${JSON.stringify(before)} as text the heading does not join`, () => {
      expect(flat(carveToHtml(`${before}\n> - > +\n# h\n`))).not.toContain('<blockquote><h1 id="h">')
    })
  }

  it('keeps a quoted line in an unclosed fence follower as fence payload', () => {
    expect(flat(carveToHtml('> # t\n> - > +\n```\n> x\n'))).toContain('<pre><code>&gt; x</code></pre>')
  })

  // A lazy line continues the item's own paragraph, so the next item's opener still starts a block.
  for (const before of ['> - a\n> ```\n> x', '> - a\n> b', '> 1. a\n> b\n> c', '> - a\n> - x\n> b', '> - > a\n> b']) {
    it(`attaches a heading after ${JSON.stringify(before)} and a sibling stacked quote plus`, () => {
      expect(flat(carveToHtml(`${before}\n> - > +\n# h\n`))).toContain('<li><blockquote><h1 id="h">h</h1></blockquote></li>')
    })
  }

  // A heading item's lazy line is a paragraph of its own, which the opener folds into.
  it('keeps the opener after a lazy line under a heading item as text', () => {
    expect(flat(carveToHtml('> - # a\n> b\n> - > +\n# h\n'))).not.toContain('<blockquote><h1 id="h">')
  })
})

// carve#3421 ruling 1: a wrapped attribute block is one construct, so after a blank line it
// loosens the list exactly as the one-line `{.c}` does.
describe('a dangling wrapped attribute after a blank line in an item', () => {
  const shapes = [
    '- a\n\n  {.c\n}\n- s\n',
    '- a\n\n  {.c\n  }\n- s\n',
    '- a\n\n  {.c\n  .d}\n- s\n',
    '1. a\n\n   {.c\n}\n2. s\n',
    '> - a\n>\n>   {.c\n> }\n> - s\n',
    '- a\n  - b\n\n    {.c\n    }\n  - s\n',
  ]
  for (const source of shapes) {
    it(`loosens ${JSON.stringify(source)} like the one-line form`, () => {
      const oneLine = source.replace(/\{\.c\n[ >]*(\.d)?\}/, (_, d: string | undefined) => `{.c${d ? ' .d' : ''}}`)
      expect(oneLine).not.toBe(source)
      expect(flat(carveToHtml(source))).toBe(flat(carveToHtml(oneLine)))
      expect(flat(carveToHtml(source))).toContain('<li><p>')
    })
  }
})

// Corpus 653-6 (carve#3421 ruling 1): a nested item's wrapped attribute closes below its column
// as one construct, so a column-0 line leaves the outer item as after the one-line `{.c}`.
describe('a wrapped attribute in a nested item closed below its column', () => {
  const shapes = [
    '- a\n  - b\n    {.c\n}\npara\n',
    '- a\n  - b\n    {.c\n.d}\npara\n',
    '- a\n  - b\n    {.c\n }\npara\n',
    '- a\n  - b\n\n    {.c\n}\npara\n',
    '- a\n  - b\n    {.c\n}\n- s\n',
    '- a\n  - b\n    {.c\n  }\npara\n',
    '- a\n  - b\n    {.c\n  .d}\npara\n',
    '1. a\n   - b\n     {.c\n    }\n  para\n',
  ]
  for (const source of shapes) {
    it(`reads ${JSON.stringify(source)} like the one-line form`, () => {
      const oneLine = source.replace(/\{\.c\n *(\.d)?\}/, (_, d: string | undefined) => `{.c${d ? ' .d' : ''}}`)
      expect(oneLine).not.toBe(source)
      expect(flat(carveToHtml(source))).toBe(flat(carveToHtml(oneLine)))
    })
  }
})
