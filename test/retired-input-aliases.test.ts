import { describe, expect, it } from 'vitest'
import { htmlToAst, lintAccessibility } from '../src/index.js'

describe('retired input aliases (markup-carve/carve#5735)', () => {
  it('imports a former carrier as an ordinary data attribute', () => {
    const paragraph = htmlToAst('<span data-djot-ref="n1">x</span>').value.children[0]
    expect(paragraph).toMatchObject({
      type: 'paragraph',
      children: [{ type: 'span', attrs: { keyValues: { 'data-djot-ref': 'n1' } } }],
    })
    expect(htmlToAst('<p data-djot-src="old">x</p>').value.children[0]).toMatchObject({
      type: 'paragraph', attrs: { keyValues: { 'data-djot-src': 'old' } },
    })
  })

  it('treats the former heading lint name as unknown in a suppression', () => {
    const source = '%% carve-lint-disable a11y/heading-jump\n# One\n\n### Three\n'
    expect(lintAccessibility(source).map((warning) => warning.rule)).toContain('heading-level-skip')
    expect(lintAccessibility(source.replace('a11y/heading-jump', 'heading-level-skip'))
      .some((warning) => warning.rule === 'heading-level-skip')).toBe(false)
    expect(lintAccessibility('<!-- carve-lint-disable a11y/heading-jump -->\n# One\n\n### Three\n')
      .map((warning) => warning.rule)).toContain('heading-level-skip')
  })

  it('treats 1,539 old-prefix host variants like ordinary data attributes', () => {
    const names = [
      'explicit-id', 'generated-id', 'ref', 'autolink', 'footnote-label',
      'inline-footnote', 'raw', 'escaped', 'abbreviations', 'col-widths',
      'label', 'id-slot', 'tight', 'xref', 'caption-number', 'div',
      'line-block', 'substitution', 'src',
    ]
    const hosts = [
      '<p ATTR>x</p>',
      '<p><span ATTR>x</span></p>',
      '<p><a href="/u" ATTR>x</a></p>',
      '<pre ATTR><code>x</code></pre>',
      '<section ATTR><h2>x</h2></section>',
      '<ul><li ATTR>x</li></ul>',
      '<blockquote><p ATTR>x</p></blockquote>',
      '<p><span><em ATTR>x</em></span></p>',
      '<p>before</p><p ATTR>x</p><p>after</p>',
    ]
    let checked = 0
    for (const name of names) for (const host of hosts) for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
      for (const value of ['', '1', 'n1']) {
        const old = htmlToAst(host.replace('ATTR', `data-djot-${name}="${value}"`), { mode })
        const ordinary = htmlToAst(host.replace('ATTR', `data-xxxx-${name}="${value}"`), { mode })
        expect(JSON.stringify(old).replaceAll('data-djot-', 'data-xxxx-')).toBe(JSON.stringify(ordinary))
        checked++
      }
    }
    expect(checked).toBe(1539)
  })
})
