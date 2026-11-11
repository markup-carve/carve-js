import { describe, expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

const html = (src: string) => renderHtml(parse(src)).trim()

describe('a wrapped glued block continues past its own brace (carve-js#4958)', () => {
  it.each([
    ['root', '{.x}{.y\n .z}\npara\n', '<p>{.x}{.y\n.z}\npara</p>'],
    ['at the second brace', '{.a}{.b\n    .c}\np\n', '<p>{.a}{.b\n.c}\np</p>'],
    ['a block opened on a continuation', '{.a\n }{.b\n  .c}\np\n', '<p>{.a\n}{.b\n.c}\np</p>'],
    ['a quote', '> {.x}{.y\n>  .z}\n> p\n', '<blockquote><p>{.x}{.y\n.z}\np</p></blockquote>'],
  ])('keeps the run as text when the continuation stops short: %s', (_name, src, out) => {
    expect(html(src)).toBe(out)
  })

  it.each([
    ['past the second brace', '{.a}{.b\n     .c}\np\n'],
    ['past a block opened on a continuation', '{.a\n }{.b\n   .c}\np\n'],
  ])('reads the run as attributes %s', (_name, src) => {
    expect(html(src)).toBe('<p class="a b c">p</p>')
  })

  it('counts an astral character before the brace as one column', () => {
    expect(html('{title="\u{1F600}"}{.b\n            .c}\np\n')).toBe('<p title="\u{1F600}" class="b c">p</p>')
    expect(html('{title="\u{1F600}"}{.b\n           .c}\np\n')).toBe('<p>{title=“\u{1F600}”}{.b\n.c}\np</p>')
  })
})

describe('an attached fence under a wrapped attribute line ends at its first blank (carve-js#4959)', () => {
  it('drops the blank from a description body', () => {
    expect(html(':: t\n: +\n{.x\n .y}\n```\nx\n\n*b*\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <pre class="x y"><code>x\n</code></pre>\n  </dd>\n</dl>\n<p><strong>b</strong></p>',
    )
  })

  it('drops the blank from a footnote body', () => {
    expect(html('[^a]: +\n{.x\n .y}\n```\nx\n\n*b*\n\nref[^a]\n')).toContain('<pre class="x y"><code>x\n</code></pre>')
  })
})
