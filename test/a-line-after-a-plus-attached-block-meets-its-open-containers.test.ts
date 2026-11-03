import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A `+` at an item's marker column changes where its block is written, not how
// later lines read: a line at the attached `<dd>`'s body column is the `<dd>`'s,
// and a marker below the item's column ends the item (PART 0 S2, CARVE-P9-067).
const html = (src: string): string => carveToHtml(src).replace(/>\s+</g, '><').trim()

describe('a line after a plus-attached block meets its open containers', () => {
  it.each([
    ['heading at the dd body column', '- a\n+\n:: term\n: d\n  # z\n',
      '<ul><li>a\n    <dl><dt>term</dt><dd><p>d</p><h1 id="z">z</h1></dd></dl></li></ul>'],
    ['overindented marker reaches the dd', '- a\n+\n:: term\n: d\n    - y\n',
      '<ul><li>a\n    <dl><dt>term</dt><dd><p>d</p><ul><li>y</li></ul></dd></dl></li></ul>'],
    // carve#5056: the blank inside the `<dd>` leaves the outer list tight.
    ['paragraph after a blank at the dd body column', '- a\n+\n:: term\n: d\n\n  x\n',
      '<ul><li>a\n    <dl><dt>term</dt><dd><p>d</p><p>x</p></dd></dl></li></ul>'],
    ['wider dd body column after a blank', '- a\n+\n:: term\n:   d\n\n    x\n',
      '<ul><li>a\n    <dl><dt>term</dt><dd><p>d</p><p>x</p></dd></dl></li></ul>'],
    ['line short of a wider dd body column ends the item', '- a\n+\n:: term\n:   d\n\n  x\n',
      '<ul><li>a\n    <dl><dt>term</dt><dd>d</dd></dl></li></ul><p>x</p>'],
    ['a description line without a term opens no dd', '- a\n+\np\n: d\n  # z\n',
      '<ul><li>a\n    p\n: d\n    <h1 id="z">z</h1></li></ul>'],
    ['ordered host, marker below the content column', '1. a\n+\n> q\n  - y\n',
      '<ol><li>a\n    <blockquote><p>q</p></blockquote></li></ol><ul><li>y</li></ul>'],
    ['bullet host, marker at column 1', '- a\n+\n> q\n - y\n',
      '<ul><li>a\n    <blockquote><p>q</p></blockquote></li></ul><ul><li>y</li></ul>'],
    ['plain text still continues the quote lazily', '1. a\n+\n> q\n  y\n',
      '<ol><li>a\n    <blockquote><p>q\ny</p></blockquote></li></ol>'],
    ['marker at the content column stays in the item', '1. a\n+\n> q\n   - y\n',
      '<ol><li>a\n    <blockquote><p>q</p></blockquote><ul><li>y</li></ul></li></ol>'],
  ])('%s', (_name, src, expected) => {
    expect(html(src)).toBe(expected)
  })
})
