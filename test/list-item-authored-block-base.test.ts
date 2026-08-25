import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

const html = (source: string): string => carveToHtml(source).trim()

describe('list-item authored block bases (carve#1705)', () => {
  const cases: Array<[string, string, string]> = [
    ['heading', '# h', '<h1 id="h">h</h1>'],
    ['quote', '> q\n   lazy', '<blockquote><p>q\nlazy</p></blockquote>'],
    ['code fence', '```\n     c\n   ```', '<pre><code>  c\n</code></pre>'],
    ['raw fence', '```=html\n     <b>x</b>\n   ```', '<b>x</b>'],
    ['comment fence', '%%%\n     hidden\n   %%%', '<li>x</li>'],
    ['colon fence', '::: note\n   body\n   :::', '<aside class="admonition note"'],
    ['table', '| A |\n   | b |', '<table>'],
    ['definition list', ':: term\n   :  def', '<dl>'],
    ['attributes plus target', '{.c}\n   # h', '<h1 class="c" id="h">h</h1>'],
    ['block image', '![a](u)', '<img src="u" alt="a">'],
  ]

  for (const [name, body, expected] of cases) {
    it(`recognizes an over-indented ${name}`, () => {
      expect(html(`- x\n\n   ${body}\n`)).toContain(expected)
    })
  }

  it('does not promote an opener below an ordered item content column', () => {
    expect(html('1. x\n > q\n')).not.toContain('<blockquote>')
  })

  it('collects over-indented link and footnote definitions', () => {
    const got = html('- x\n\n   [r]: /u\n   [^n]: note\n\nSee [r][] and [^n].\n')
    expect(got).toContain('<a href="/u">r</a>')
    expect(got).toContain('role="doc-noteref"')
  })

  it('leaves descendant ownership with the descendant item', () => {
    const got = html('- - item\n\n    # exact\n')
    expect(got.indexOf('<ul>', 4)).toBeGreaterThanOrEqual(0)
    expect(got.indexOf('<h1')).toBeGreaterThan(got.indexOf('<ul>', 4))
  })

  it('returns a block dedented below a descendant to the parent item', () => {
    const got = html('- a\n  - b\n\n   > q\n')
    expect(got).toContain('</ul>\n    <blockquote><p>q</p></blockquote>')
  })

  it('canonicalizes the opener base but preserves payload indentation', () => {
    const formatted = carveToCarve('- x\n\n   ```\n     c\n   ```\n')
    expect(formatted).toBe('- x\n  ```\n    c\n  ```\n')
    expect(carveToCarve(formatted)).toBe(formatted)
  })

  it('anchors content positions in the authored source', () => {
    const source = '- x\n\n   # heading\n'
    const document = parse(source) as any
    const heading = document.children[0].items[0].children.find((node: any) => node.type === 'heading')
    const text = heading.children[0]
    expect(source.slice(text.pos.startOffset, text.pos.endOffset)).toBe('heading')
  })
})
