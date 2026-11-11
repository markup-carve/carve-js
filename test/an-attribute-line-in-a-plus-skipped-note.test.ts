import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const compact = (html: string): string => html.replace(/>\s+</g, '><').trim()
const note = (body: string): string => `<li id="fn1"><p>${body}<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p></li>`

// carve#5957, PART 9 §15 A1 and A4, CARVE-P9-067: an attribute line in a note a `+` skips ends the
// note's paragraph and stays in the note, wherever it is indented past the body column.
describe('an attribute line in a note a plus skips', () => {
  it.each([
    ['- +\n[^m]: n\n\t{y}\n\n[^m]\n'],
    ['- +\n[^m]: n\n  {y}\n\n[^m]\n'],
    ['- +\n[^m]: n\n    {y}\n\n[^m]\n'],
    ['- +\n[^m]: n\n       {y}\n\n[^m]\n'],
  ])('drops the attribute at the note end in %j', (source) => {
    const html = compact(carveToHtml(source))
    expect(html).toContain('<ul><li></li></ul><p><a id="fnref1"')
    expect(html).toContain(note('n'))
  })

  it.each([
    ['- +\n[^m]: n\n  {y}\nq\n\np[^m]\n'],
    ['- +\n[^m]: n\n\t{y}\nq\n\np[^m]\n'],
    ['- +\n[^m]: n\n    {y}\nq\n\np[^m]\n'],
  ])('attaches the next line at the marker column to the item in %j', (source) => {
    const html = compact(carveToHtml(source))
    expect(html).toContain('<ul><li>q</li></ul><p>p<a id="fnref1"')
    expect(html).toContain(note('n'))
  })

  it('keeps a body-column paragraph after the attribute in the note', () => {
    const html = compact(carveToHtml('- +\n[^m]: n\n    {y}\n  r\n\np[^m]\n'))
    expect(html).toContain('<p>n</p><p y="">r<a href="#fnref1"')
  })
})
