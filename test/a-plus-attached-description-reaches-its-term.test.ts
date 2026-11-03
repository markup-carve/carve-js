import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A description a separate-line `+` attaches in a list-hosted quote joins the
// open term, whatever its source column.
const html = (src: string): string => carveToHtml(src).replace(/>\s+</g, '><').trim()

describe('a plus-attached description reaches its term', () => {
  it.each([
    ['list-hosted quote, description after a separate-line plus', '- > :: t\n  +\n  : x\n  q\n',
      '<ul><li><blockquote><dl><dt>t</dt><dd>x\nq</dd></dl></blockquote></li></ul>'],
    ['term and description attached', '- > :: t\n  +\n  :: v\n  : w\n',
      '<ul><li><blockquote><dl><dt>t</dt><dt>v</dt><dd>w</dd></dl></blockquote></li></ul>'],
    ['quoted plus line', '- > :: t\n  > +\n  > : x\n',
      '<ul><li><blockquote><dl><dt>t</dt></dl><p>+\n: x</p></blockquote></li></ul>'],
    ['nested in a quote', '> - > :: t\n>   +\n>   : x\n',
      '<blockquote><ul><li><blockquote><dl><dt>t</dt><dd>x</dd></dl></blockquote></li></ul></blockquote>'],
    ['ordered host', '1. > :: t\n   +\n   : x\n',
      '<ol><li><blockquote><dl><dt>t</dt><dd>x</dd></dl></blockquote></li></ol>'],
    ['without a plus the line stays a paragraph', '- > :: t\n  : x\n',
      '<ul><li><blockquote><dl><dt>t</dt></dl></blockquote>\n    : x\n  </li></ul>'],
  ])('%s', (_name, src, expected) => {
    expect(html(src)).toBe(expected)
  })
})
