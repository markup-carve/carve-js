import { describe, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

// Expected HTML is cmark-gfm's reading (comrak 0.x with the GFM extensions),
// as quoted in the Expected sections of markup-carve/carve#4926, #4928, #4923
// and #4937.
const html = (markdown: string): string => carveToHtml(markdownToCarve(markdown)).replace(/\n\s*/g, '')

describe('a GFM table ends where cmark-gfm ends it (carve#4926, carve#4928)', () => {
  it('leaves a lazy line after a quoted table outside the quote', () => {
    expect(html('> a | b\n> --- | ---\n> c | d\ne | f\n')).toBe(
      '<blockquote><table><thead><tr><th scope="col">a</th><th scope="col">b</th></tr></thead>'
      + '<tbody><tr><td>c</td><td>d</td></tr></tbody></table></blockquote><p>e | f</p>',
    )
  })

  it('takes a quoted dash underline under plain text as setext, not a delimiter row', () => {
    expect(html('> heading\n> ---\n> paragraph\nlazy\n')).toBe(
      '<blockquote><h2 id="heading">heading</h2><p>paragraph\nlazy</p></blockquote>'.replace(/\n/g, ''),
    )
  })

  it('does the same for a quoted table an item holds', () => {
    expect(html('- > a | b\n  > --- | ---\n  > c | d\n  e | f\n')).toBe(
      '<ul><li><blockquote><table><thead><tr><th scope="col">a</th><th scope="col">b</th></tr></thead>'
      + '<tbody><tr><td>c</td><td>d</td></tr></tbody></table></blockquote>e | f</li></ul>',
    )
  })

  it('keeps the body rows of a table indented in a list item', () => {
    expect(html('- x\n\n    a|b\n    -|-\n    1|2\n')).toBe(
      '<ul><li><p>x</p><table><thead><tr><th scope="col">a</th><th scope="col">b</th></tr></thead>'
      + '<tbody><tr><td>1</td><td>2</td></tr></tbody></table></li></ul>',
    )
  })

  it('opens no table under a header that is indented code', () => {
    expect(html('    | a | b |\n  | - | - |\n  | c | d |\n')).toBe(
      '<pre><code>| a | b |</code></pre><p>| - | - || c | d |</p>',
    )
  })

  it('reads an empty marker after a table body as an empty item', () => {
    expect(html('a | b\n--|--\n1 | 2\n*\n')).toBe(
      '<table><thead><tr><th scope="col">a</th><th scope="col">b</th></tr></thead>'
      + '<tbody><tr><td>1</td><td>2</td></tr></tbody></table><ul><li></li></ul>',
    )
    expect(html('> a | b\n> --|--\n> 1 | 2\n> *\n')).toBe(
      '<blockquote><table><thead><tr><th scope="col">a</th><th scope="col">b</th></tr></thead>'
      + '<tbody><tr><td>1</td><td>2</td></tr></tbody></table><ul><li></li></ul></blockquote>',
    )
  })

  it('takes `- | -` as a list item, which interrupts the header line', () => {
    expect(html('a | b\\\n- | -\n1 | 2\n')).toBe('<p>a | b\\</p><ul><li>| -\n1 | 2</li></ul>'.replace(/\n/g, ''))
  })

  it('ends an item paragraph that starts with a pipe only where a row would', () => {
    expect(html('- | -\nfoo\n')).toBe('<ul><li>| -\nfoo</li></ul>'.replace(/\n/g, ''))
  })

  it('opens an item at an empty marker left of the item a lazy line continues', () => {
    expect(html('- a\nb\n-\n')).toBe('<ul><li>a\nb</li><li></li></ul>'.replace(/\n/g, ''))
  })

  it('reads a line after code that ended a table as text', () => {
    expect(markdownToCarve('  a | b\n  --|--\n    1 | 2\n| e | f |\n')).toBe(
      '|= a |= b |\n\n```\n1 | 2\n```\n\n\\| e | f |\n',
    )
  })
})

describe('a reference definition spread over lines keeps its link (carve#4923)', () => {
  it('reads a label that wraps inside a quote', () => {
    expect(html('> [foo\n> bar]: /url\n>\n> [foo bar]\n')).toBe('<blockquote><p><a href="/url">foo bar</a></p></blockquote>')
  })

  it('reads a quoted definition whose destination is on a lazy line', () => {
    expect(html('> [Rust]:\nhttps://rust-lang.org\n\n[Rust]\n')).toBe(
      '<blockquote></blockquote><p><a href="https://rust-lang.org">Rust</a></p>',
    )
  })

  it('takes no destination from a lazy line that opens an HTML block', () => {
    expect(html('> [x]:\n<div>\n\n[x]\n')).not.toContain('href')
    expect(html('> [a]:\n<https://example.com>\n\n[a]\n')).toContain('<a href="https://example.com">a</a>')
  })

  it('keeps a title that opens on the next line and wraps', () => {
    expect(carveToHtml(markdownToCarve("[m]: https://e.com\n'\npart'\n\n[m]\n")).trim()).toBe(
      '<p><a href="https://e.com" title="\npart">m</a></p>',
    )
  })

  it('keeps an indented line after a definition as paragraph text', () => {
    expect(html('[l]: a\n    - b\n')).toBe('<p>- b</p>')
    expect(html('[l]: a\n    1. b\n')).toBe('<p>1. b</p>')
  })
})

describe('a parenthesized link title may hold escaped parentheses (carve#4937)', () => {
  it('reads an escaped close paren across a line break', () => {
    expect(carveToHtml(markdownToCarve('[a](b (\n\\)))\n')).trim()).toBe('<p><a href="b" title="\n)">a</a></p>')
  })

  it('reads an escaped open paren', () => {
    expect(html('[](u (x\\())\n')).toBe('<p><a href="u" title="x("></a></p>')
  })
})
