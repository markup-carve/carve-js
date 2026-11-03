import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

const rendered = (source: string): string => carveToHtml(source).replace(/\s*\n\s*/g, '')

describe('a comment closer past the host (carve#4770 ruling B)', () => {
  it.each([
    ['> %%%\n> n\nzz\n%%%\n', '<blockquote></blockquote><p>zz</p>'],
    ['> > %%%\n> > n\nzz\n%%%\n', '<blockquote><blockquote></blockquote></blockquote><p>zz</p>'],
    ['> %%%\n> - a\nzz\n%%%\n', '<blockquote></blockquote><p>zz</p>'],
    ['- a\n  > %%%\n  > n\n  zz\n%%%\n', '<ul><li>a<blockquote></blockquote>zz</li></ul>'],
    ['- a\n  :: u\n  : %%%\n    n\n  zz\n%%%\n', '<ul><li>a<dl><dt>u</dt><dd></dd></dl>zz</li></ul>'],
  ])('ends the span and the nested host at the missed line: %j', (source, html) => {
    expect(rendered(source)).toBe(html)
  })

  it.each([
    ['> %%%\n> n\n\n%%%\n', '<blockquote></blockquote>'],
    ['> %%%\n> n\n- zz\n  > %%%\n', '<blockquote></blockquote><ul><li>zz<blockquote></blockquote></li></ul>'],
    ['> - %%%\n>   n\nzz\n%%%\n', '<blockquote><ul><li></li></ul></blockquote><p>zz</p>'],
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
    expect(rendered('. a\n  . %%%\n    n\n\n%%%\n')).toBe('<ol><li>a<ol><li></li></ol></li></ol>')
  })
})

describe('fmt keeps a comment after a block attached at the marker column (#4211)', () => {
  it('reads back to the same HTML and is a fixed point', () => {
    const source = '. a\n  . %%%\n    n\n  zz\n%%%\n'
    const written = carveToCarve(source)
    // Both spans are unclosed, so the writer closes each where its parse ended (carve#4907).
    expect(written).toBe('. a\n  . %%%\n    n\n    %%%\n  zz\n  %%%\n  %%%\n')
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(carveToCarve(written)).toBe(written)
  })
})
