import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)
const item = (tag: string) => `<${tag}>\n        <li>a</li>\n      </${tag}>`

// A wrapped attribute opened at a note marker-line item's column is one block (§15 A5): its
// column-0 closer belongs to the run, not to the item's paragraph.
describe('a wrapped attribute at a note marker-line item column', () => {
  it('keeps a column-0 closer out of the item', () => {
    expect(h('[^n]: - a\n        {.c\n}\n\nx[^n]\n')).toContain(item('ul'))
    expect(h('[^n]: - a\n\n        {.c\n}\n\nx[^n]\n')).toContain(item('ul'))
  })

  it('holds a multi-line run and leaves the next line to the note', () => {
    const html = h('[^n]: 1. a\n         {#i .c\n         .d\n}\n  b\n\nx[^n]\n')
    expect(html).toContain(item('ol'))
    expect(html).toContain('<p>b<a href="#fnref1"')
  })

  it('does the same inside a quote', () => {
    expect(h('> [^n]: - a\n>         {.c\n> }\n>\n> x[^n]\n')).toContain(item('ul'))
  })
})
