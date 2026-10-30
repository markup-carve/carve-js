import { describe, expect, it } from 'vitest'
import { parse, renderHtml, resolve } from '../src/index.js'

const html = (source: string): string => renderHtml(resolve(parse(source))).trim()

describe('a token inside a literal directive opens nothing (CARVE-P6-001, carve#4296)', () => {
  it.each([
    ['*{{ `@lines:1 }}ter*\n', '<p><strong>{{ `@lines:1 }}ter</strong></p>'],
    ['/a {{ ``x @code }} b/\n', '<p><em>a {{ ``x @code }} b</em></p>'],
    ['={{ $`x @lines:0-2 }}=\n', '<p><mark>{{ $`x @lines:0-2 }}</mark></p>'],
    ['~{{ %%@lines:1 }}~\n', '<p><s>{{ %%@lines:1 }}</s></p>'],
    ['[a {{ [x @code }} b](/u)\n', '<p><a href="/u">a {{ [x @code }} b</a></p>'],
    ['{*a {{ {*x @code }} b*}\n', '<p><strong>a {{ {*x @code }} b</strong></p>'],
    ['{{ `x @code }} /*a*/\n', '<p>{{ `x @code }} <strong><em>a</em></strong></p>'],
  ])('%j', (source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it('restores the characters in the tree', () => {
    expect(JSON.stringify(parse('*{{ `[{$%@lines:1 }}*\n'))).not.toMatch(/[\uE000-\uF8FF]/)
  })

  it('leaves private-use characters the author wrote alone', () => {
    expect(html('\uE100 *{{ `\uE101@lines:1 }}ter* \uF8F0\n'))
      .toBe('<p>\uE100 <strong>{{ `\uE101@lines:1 }}ter</strong> \uF8F0</p>')
  })
})

describe('a comment-only quote takes no caption (CARVE-P9-080, carve#4220)', () => {
  it.each(['> %%\n^ cap\n', '> %%%\n> x\n> %%%\n^ cap\n', '> {.c}\n> %%\n^ cap\n'])('%j', (source) => {
    expect(html(source)).toBe('<blockquote>\n\n</blockquote>\n<p>^ cap</p>')
  })

  it('keeps the caption of a quote with content', () => {
    expect(html('> a %% c\n^ cap\n')).toContain('<figcaption>cap</figcaption>')
  })
})

describe("a description's attributed paragraph keeps its element (CARVE-P9-081, carve#4309)", () => {
  it.each([':: T\n: {.c}\n  q\n', ':: T\n: +\n{.c}\nq\n'])('%j', (source) => {
    expect(html(source)).toBe('<dl>\n  <dt>T</dt>\n  <dd><p class="c">q</p></dd>\n</dl>')
  })

  it('leaves an unattributed paragraph bare', () => {
    expect(html(':: T\n: q\n')).toBe('<dl>\n  <dt>T</dt>\n  <dd>q</dd>\n</dl>')
  })
})
