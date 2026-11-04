import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)
// A column-0 closer does not pass the `{` column, so the run is the item's paragraph text
// (carve#5080, replacing the one-block reading of §15 A5 for this shape).
describe('a wrapped attribute at a note marker-line item column', () => {
  it('keeps a refused run in the item', () => {
    expect(h('[^n]: - a\n        {.c\n}\n\nx[^n]\n')).toContain('<ul>\n        <li>a\n{.c\n}</li>\n      </ul>')
    expect(h('[^n]: - a\n\n        {.c\n}\n\nx[^n]\n')).toContain('<li><p>a</p>\n          <p>{.c\n}</p>\n        </li>')
  })

  it('folds the next line into the refused run', () => {
    const html = h('[^n]: 1. a\n         {#i .c\n         .d\n}\n  b\n\nx[^n]\n')
    expect(html).toContain('<li>a\n{#i .c\n.d\n}\nb</li>')
  })

  it('does the same inside a quote', () => {
    expect(h('> [^n]: - a\n>         {.c\n> }\n>\n> x[^n]\n')).toContain('<ul>\n        <li>a\n{.c\n}</li>\n      </ul>')
  })
})
