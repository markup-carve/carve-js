import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// Follow-ups to the carve#4861 port, measured against the spec model at
// markup-carve/carve 95b31d95.
const flat = (html: string) => html.replace(/>\s+</g, '><').replace(/\s+</g, '<').trim()

describe('a line after a one-line term reaches its own owner', () => {
  it('opens a nested description in a description body inside an item', () => {
    expect(flat(carveToHtml('- a\n  :: outer\n  : x\n    :: child\n    : body\n'))).toBe(
      '<ul><li>a<dl><dt>outer</dt><dd><p>x</p><dl><dt>child</dt><dd>body</dd></dl></dd></dl></li></ul>',
    )
  })

  it.each([
    '- - a\n    :: m\n  : l\n',
    '- x\n  - y\n    :: t\n  : l\n',
  ])('reads a separator after a nested item term in the outer item: %j', (source) => {
    expect(flat(carveToHtml(source))).toMatch(/<\/ul>\s*: l\s*<\/li><\/ul>$/)
  })

  it('keeps a quoted item paragraph after a term open for an unprefixed separator', () => {
    expect(flat(carveToHtml('> - :: t\n>    wrapped\n: dd\n'))).toBe(
      '<blockquote><ul><li><dl><dt>t</dt></dl>\n      wrapped\n: dd</li></ul></blockquote>',
    )
  })
})
