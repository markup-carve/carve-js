import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const NOTE = '<aside class="admonition note" aria-label="Note">'
const html = (...lines: string[]): string => carveToHtml(lines.join('\n') + '\n')

// An attached colon body ends at its closer, first blank or host sibling, so a
// list marker in it is the paragraph's text (carve#5658 ruling A, carve-js#4928).
describe('a +-attached colon in a description or note keeps a list marker line', () => {
  it('in a description', () => {
    expect(html(':: t', ':  +', '::: note', 'x', '- y')).toBe(
      `<dl>\n  <dt>t</dt>\n  <dd>\n    ${NOTE}\n      <p>x\n- y</p>\n    </aside>\n  </dd>\n</dl>`,
    )
  })

  it('in a note', () => {
    expect(html('[^n]: +', '::: note', 'x', '- y', '', 'r[^n]')).toContain(`${NOTE}\n        <p>x\n- y</p>`)
  })
})

// A bare `:::` after a note's own-line `+` opens a div when no colon block is
// open around the note (PART 9 §17 L3, carve-js#4929).
describe('a bare colon opener after a note +', () => {
  it('is the attached div', () => {
    expect(html('[^n]: x', '+', ':::', 'x', 'zq', '', 'r[^n]')).toContain(
      '<li id="fn1">\n      <p>x</p>\n      <div>\n        <p>x\nzq</p>\n      </div>',
    )
  })

  it('still closes a div that holds the note', () => {
    expect(html('::: note', '[^n]: x', '+', ':::', '', 'r[^n]')).not.toContain('<li id="fn1">\n      <p>x</p>\n      <div>')
  })
})
