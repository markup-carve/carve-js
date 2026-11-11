import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const compact = (html: string): string => html.replace(/\s*\n\s*/g, '').trim()
const note = (body: string): string => `<li id="fn1"><p>${body}<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p></li>`

// carve#5963: a note a nested item's `+` skips leads the item body, but it is not a note on the
// marker line, so its attribute line stays in the note (PART 9 §15 A4) and the `+` attaches `q`.
describe('an attribute line in a note a nested plus skips', () => {
  it.each([
    ['- x\n  - +\n  [^m]: n\n    {#i}\n  q\n\np[^m]\n', '<ul><li>x<ul><li>q</li></ul></li></ul>'],
    ['- x\n\n  - +\n  [^m]: n\n    {#i}\n  q\n\np[^m]\n', '<ul><li><p>x</p><ul><li>q</li></ul></li></ul>'],
    ['- x\n  - y\n    - +\n    [^m]: n\n      {.c}\n    q\n\np[^m]\n', '<ul><li>x<ul><li>y<ul><li>q</li></ul></li></ul></li></ul>'],
    ['> - x\n>   - +\n>   [^m]: n\n>     {#i}\n>   q\n\np[^m]\n', '<blockquote><ul><li>x<ul><li>q</li></ul></li></ul></blockquote>'],
  ])('keeps the attribute in the note in %j', (source, list) => {
    const html = compact(carveToHtml(source))
    expect(html).toContain(`${list}<p>p<a id="fnref1"`)
    expect(html).toContain(note('n'))
  })
})
