import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

const rendered = (source: string): string => carveToHtml(source).replace(/\s*\n\s*/g, '')

describe('a comment closer past the host (carve#4770 ruling B)', () => {
  it.each([
    ['> %%%\n> n\nzz\n%%%\n', '<blockquote><p>n</p></blockquote><p>zz</p>'],
    ['> > %%%\n> > n\nzz\n%%%\n', '<blockquote><blockquote><p>n</p></blockquote></blockquote><p>zz</p>'],
    ['> %%%\n> - a\nzz\n%%%\n', '<blockquote><ul><li>a</li></ul></blockquote><p>zz</p>'],
    ['- a\n  > %%%\n  > n\n  zz\n%%%\n', '<ul><li>a<blockquote><p>n</p></blockquote>zz</li></ul>'],
    ['- a\n  :: u\n  : %%%\n    n\n  zz\n%%%\n', '<ul><li>a<dl><dt>u</dt><dd>n</dd></dl>zz</li></ul>'],
  ])('ends the span and the nested host at the missed line: %j', (source, html) => {
    expect(rendered(source)).toBe(html)
  })

  it.each([
    ['> %%%\n> n\n\n%%%\n', '<blockquote><p>n</p></blockquote>'],
    ['> %%%\n> n\n- zz\n  > %%%\n', '<blockquote><p>n- zz&gt;</p></blockquote>'],
    ['> - %%%\n>   n\nzz\n%%%\n', '<blockquote><ul><li>nzz</li></ul></blockquote>'],
  ])('finds no closer past a blank, an indented quote marker or a lazy line: %j', (source, html) => {
    expect(rendered(source)).toBe(html)
  })
})

describe('a blank line before a closer below the item column (carve#4889)', () => {
  it.each([
    ['. %%%\n  n\n\n%%%\n', '<ol><li></li></ol>'],
    ['. a\n  %%%\n  n\n\n%%%\n', '<ol><li>a</li></ol>'],
    ['. a\n  . %%%\n    n\n\n  %%%\n', '<ol><li>a<ol><li></li></ol></li></ol>'],
  ])('keeps the payload hidden: %j', (source, html) => {
    expect(rendered(source)).toBe(html)
  })

  it('leaves a child marker span to end at a column-zero closer', () => {
    expect(rendered('. a\n  . %%%\n    n\n\n%%%\n')).toBe('<ol><li>a<ol><li>n</li></ol></li></ol>')
  })
})

describe('fmt keeps a comment after a block attached at the marker column (#4211)', () => {
  it('reads back to the same HTML and is a fixed point', () => {
    const source = '. a\n  . %%%\n    n\n  zz\n%%%\n'
    const written = carveToCarve(source)
    expect(written).toBe('. a\n  . %% %\n    n\n+\nzz\n  %% %\n')
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(carveToCarve(written)).toBe(written)
  })
})
