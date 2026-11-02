import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderCarve } from '../src/index.js'

// carve#4873 ruling B: a footnote definition opens a frame, so it is no invisible sibling line (§10 I5, CARVE-P9-052).
describe('a footnote definition between siblings (carve#4873)', () => {
  const twoLists = '<ul>\n  <li>a</li>\n</ul>\n<ul>\n  <li>b</li>\n</ul>'

  it.each([
    ['a one-token body', '[^f]: x'],
    ['a destination and title', '[^f]: /u "t"'],
    ['a two-word body', '[^f]: x y'],
  ])('ends the list at a note with %s', (_kind, note) => {
    expect(carveToHtml(`- a\n\n${note}\n\n- b\n`)).toBe(twoLists)
  })

  it('ends a description list at a note', () => {
    expect(carveToHtml(':: t\n[^f]: a\n\n: d\n')).toBe('<dl>\n  <dt>t</dt>\n</dl>\n<p>: d</p>')
  })

  it('keeps the two lists apart when written back', () => {
    const written = renderCarve(parse('- a\n\n[^f]: x\n\n- b\n'))
    expect(written).toBe('- a\n\n\n\n- b\n\n[^f]: x\n')
    expect(carveToHtml(written)).toBe(twoLists)
  })

  it.each(['[^1]: a', '[^1]: a b'])('lets a note\'s first-block + skip the definition %s', (note) => {
    const html = carveToHtml(`[^a]: +\n${note}\n~~~\nx\n~~~\n\nsee[^a]\n`)
    expect(html.startsWith('<p>see')).toBe(true)
    expect(html).toContain('<li id="fn1">\n      <pre><code>x\n</code></pre>')
  })
})
