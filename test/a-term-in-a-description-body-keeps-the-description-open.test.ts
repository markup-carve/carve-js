import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalized = (html: string) => html.replace(/\n\s*/g, '')

// A term is one line (markup-carve/carve#4861): in a description body it ends the paragraph, not the description (#4243).
describe('a term in a description body keeps the description open', () => {
  it.each([
    '- a\n  :: outer\n  : x\n    :: child\n    - y\n',
    '- a\n  :: outer\n  : x\n     :: child\n    - y\n',
    '- a\n  :: outer\n  : x\n      :: child\n    - y\n',
  ])('reads a list at the description body column into the description: %j', (source) => {
    expect(normalized(carveToHtml(source))).toBe(
      '<ul><li>a<dl><dt>outer</dt><dd><p>x</p><dl><dt>child</dt></dl><ul><li>y</li></ul></dd></dl></li></ul>',
    )
  })

  it.each([
    '- x\n  :: outer\n  : d\n    :: t\nplain\n',
    '- x\n  :: outer\n  : d\n     :: t\nplain\n',
  ])('lets a flush line after the term leave the item: %j', (source) => {
    expect(normalized(carveToHtml(source))).toBe(
      '<ul><li>x<dl><dt>outer</dt><dd><p>d</p><dl><dt>t</dt></dl></dd></dl></li></ul><p>plain</p>',
    )
  })
})
