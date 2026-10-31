import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, toAstJson } from '../src/index.js'

// PART 2 CARVE-P2-021 and PART 9 section 4: a reference image binds its caption
// slot only once it resolves; otherwise the slot's source returns to the
// paragraph as text. The slot holds one `^ ` marker line, so a second one starts
// a paragraph of its own whatever the label spelling.
describe('a reference image caption slot', () => {
  it('gives a slot after one blank line back to an unresolved image paragraph', () => {
    expect(carveToHtml('![a][ok]\n\n^ cap\n')).toBe('<p>![a][ok]\n^ cap</p>')
    expect(carveToHtml('![a][ok]\n\n^ cap *b*\nmore\n')).toBe('<p>![a][ok]\n^ cap <strong>b</strong>\nmore</p>')
    expect(carveToHtml('- ![a][ok]\n\n  ^ cap\n')).toBe('<ul>\n  <li>![a][ok]\n^ cap</li>\n</ul>')
  })

  it('still binds the slot when the reference resolves', () => {
    expect(carveToHtml('![a][ok]\n\n^ cap\n\n[ok]: /u\n'))
      .toBe('<figure>\n  <img src="/u" alt="a">\n  <figcaption>cap</figcaption>\n</figure>')
  })

  it('publishes the unresolved shape as a paragraph in the tree', () => {
    const ast = toAstJson(parse('![a][ok]\n\n^ cap\n'))
    const paragraph = ast.children[0] as { type: string; children: Array<{ type: string; value?: string }> }
    expect(ast.children).toHaveLength(1)
    expect(paragraph.type).toBe('paragraph')
    expect(paragraph.children.map((child) => child.type)).toEqual(['image', 'soft_break', 'text'])
    expect(paragraph.children[2]!.value).toBe('^ cap')
  })

  it('ends the slot at a second marker for a collapsed label and for attribute blocks', () => {
    expect(carveToHtml('![a][]\n^ cap\n^ two\n\n[a]: /u\n'))
      .toBe('<figure>\n  <img src="/u" alt="a">\n  <figcaption>cap</figcaption>\n</figure>\n<p>^ two</p>')
    expect(carveToHtml('![a][ok]{.k}\n^ cap\n^ two\n\n[ok]: /u\n'))
      .toBe('<figure>\n  <img src="/u" alt="a" class="k">\n  <figcaption>cap</figcaption>\n</figure>\n<p>^ two</p>')
    expect(carveToHtml('![a][ok]{.k}{#i}\n^ cap\n^ two\n')).toBe('<p>![a][ok]{.k}{#i}\n^ cap</p>\n<p>^ two</p>')
    expect(carveToHtml('![a][]\n^ cap\n^ two\n')).toBe('<p>![a][]\n^ cap</p>\n<p>^ two</p>')
  })

  it('keeps an image with an empty or invalid attribute block out of the slot', () => {
    expect(carveToHtml('![a][ok]{}\n^ cap\n^ two\n\n[ok]: /u\n'))
      .toBe('<p><img src="/u" alt="a">{}\n^ cap\n^ two</p>')
    expect(carveToHtml('![a][ok]{=x}\n^ cap\n^ two\n\n[ok]: /u\n'))
      .toBe('<p><img src="/u" alt="a">{=x}\n^ cap\n^ two</p>')
  })
})
