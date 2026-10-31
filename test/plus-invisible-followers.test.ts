import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// CARVE-P9-067, markup-carve/carve#4449: invisible lines do not decide a
// continuation marker. The next visible line does, including when it refuses.
describe('invisible followers of a continuation marker', () => {
  it('attaches the first visible block past a line comment', () => {
    expect(carveToHtml('- +\n%% hidden\ntext')).toBe('<ul>\n  <li>text</li>\n</ul>')
  })

  it('keeps a refused marker literal past a line comment', () => {
    expect(carveToHtml('- +\n%% hidden\n\ntext')).toBe('<ul>\n  <li>+</li>\n</ul>\n<p>text</p>')
  })

  it('looks past a fenced comment and its payload', () => {
    expect(carveToHtml('- +\n%%%\nhidden\n%%%\ntext')).toBe('<ul>\n  <li>text</li>\n</ul>')
  })

  it('keeps a document-level abbreviation available to inline parsing', () => {
    expect(carveToHtml('- +\n*[A]: b\ntext\n\nA')).toBe(
      '<ul>\n  <li>text</li>\n</ul>\n<p><abbr title="b">A</abbr></p>',
    )
  })

  it('does not collect a quoted abbreviation at document level', () => {
    expect(carveToHtml('> a\n> +\n> *[A]: b\n> text\n\nA')).toBe(
      '<blockquote><p>a\n+\n*[A]: b\ntext</p></blockquote>\n<p>A</p>',
    )
  })

  it('lets an abbreviation separate a refused item from a later sibling', () => {
    expect(carveToHtml('- +\n*[A]: b\n- b')).toBe(
      '<ul>\n  <li>+</li>\n</ul>\n<ul>\n  <li>b</li>\n</ul>',
    )
  })

  it('lets an abbreviation release an indented line from a description', () => {
    expect(carveToHtml(':: t\n: +\n*[A]: b\n  text')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>+</dd>\n</dl>\n<p>text</p>',
    )
  })

  it('lets an abbreviation release an indented line from a footnote', () => {
    expect(carveToHtml('[^f]: +\n*[A]: b\n  text\n\nr[^f]')).toContain('<p>text</p>\n<p>r')
  })

  it('reads the next visible block past a footnote definition', () => {
    expect(carveToHtml(':: t\n: +\n[^x]: note\n- b')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>b</li>\n    </ul>\n  </dd>\n</dl>',
    )
  })
})
