import { describe, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

const html = (markdown: string): string =>
  carveToHtml(markdownToCarve(markdown)).replace(/>\s+</g, '><').replaceAll('&nbsp;', '\u00a0').trim()

// Expected HTML is cmark 0.31.2 (cmark-gfm where GFM decides), whitespace aside.
describe('the Markdown importer follows CommonMark on autolinks, mentions and definitions', () => {
  // markup-carve/carve#4929: a pointy URI stops at ASCII controls and space, as cmark's scanner does.
  it.each([
    ['<http://a\u00a0b>\n', '<p><a href="http://a%C2%A0b">http://a\u00a0b</a></p>'],
    ['x <http://a\u2003b> y\n', '<p>x <a href="http://a%E2%80%83b">http://a\u2003b</a> y</p>'],
    ['<http://a\u007fb>\n', '<p><a href="http://a%7Fb">http://a\u007fb</a></p>'],
  ])('keeps a pointy autolink holding a Unicode space or DEL: %j', (markdown, expected) => {
    expect(html(markdown)).toBe(expected)
  })

  it('does not take a control character into a pointy autolink', () => {
    expect(markdownToCarve('<mailto:a\u0001b>\n')).not.toContain('](mailto:')
    expect(html('<http://\u0007>\n')).not.toContain('href="http://%07"')
  })

  // markup-carve/carve#4946: a mention after an emphasis closer.
  it.each(['x _a_@b c\n', '_a_@b\n', 'snake_@x\n', '[_a_@b](u)\n'])('keeps `@` literal after an underscore: %j', markdown => {
    expect(html(markdown)).not.toContain('<strong>@')
    expect(html(markdown)).toContain('@')
  })

  it('writes the ticket reproduction with an escaped at sign', () => {
    expect(markdownToCarve('x _a_@b c\n')).toBe('x /a/\\@b c\n')
    expect(html('x _a_@b c\n')).toBe('<p>x <em>a</em>@b c</p>')
  })

  // markup-carve/carve#4922: labels and destinations CommonMark rejects.
  it.each([
    ['[\\]: test\n', '<p>[]: test</p>'],
    ['[a\\]: test\n', '<p>[a]: test</p>'],
    ['[ ]: test\n', '<p>[ ]: test</p>'],
    ['[\t]: test\n', '<p>[\t]: test</p>'],
    ['> [ ]: t\n', '<blockquote><p>[ ]: t</p></blockquote>'],
    ['- [x]: (\n', '<ul><li>[x]: (</li></ul>'],
  ])('keeps a rejected definition as paragraph text: %j', (markdown, expected) => {
    expect(html(markdown)).toBe(expected)
  })

  it.each(['[x]: (\n\n[x]\n', '[x]: a((b)\n\n[x]\n', '[x]: )\n\n[x]\n', '[x]: a)b\n\n[x]\n'])(
    'defines no link through an unbalanced destination: %j', markdown => {
      expect(html(markdown)).not.toContain('<a ')
      expect(html(markdown)).toContain('[x]')
    },
  )

  it('leaves a footnote body with an open parenthesis a footnote', () => {
    expect(markdownToCarve('| h |\n|---|\n| [^a\\|b] |\n\n[^a|b]: a(\n')).toContain('[^carve-import-footnote-1]: a(')
    expect(markdownToCarve('x[^1]\n\n[^1]: a(\n')).toBe('x[^1]\n\n[^1]: a(\n')
  })

  it.each([
    ['[x]: a(b)\n\n[x]\n', '<p><a href="a(b)">x</a></p>'],
    ['[x]: a\\(b\n\n[x]\n', '<p><a href="a(b">x</a></p>'],
    ['[x]: <(>\n\n[x]\n', '<p><a href="(">x</a></p>'],
    ['[ a ]: /u\n\n[a]\n', '<p><a href="/u">a</a></p>'],
  ])('still defines a link CommonMark accepts: %j', (markdown, expected) => {
    expect(html(markdown)).toBe(expected)
  })
})
