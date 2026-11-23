import { describe, expect, it } from 'vitest'
import { format, render } from '../public/index.ts'

// carve#6507. C2-B-083, C2-B-084: the edges of a definition's continuation lines that the clause cases leave open.
describe('C2-B-083, C2-B-084: lines that continue a link or abbreviation definition', () => {
  it('takes one tail line only; a second indented attribute block is an attribute line of the next block', () => {
    expect(render('[a]: /u\n  "T"\n  {.c}\nPara\n\nSee [a].\n')).toBe('<p class="c">Para</p>\n<p>See <a href="/u" title="T">a</a>.</p>')
  })

  it('takes no title below a definition line that has an attribute block', () => {
    expect(render('[a]: /u {.c}\n  "T"\n\nSee [a].\n')).toBe('<p>“T”</p>\n<p>See <a href="/u" class="c">a</a>.</p>')
  })

  it('ends an abbreviation at a blank line', () => {
    expect(render('*[A]: x\n  y\n\n  z\n\nA\n')).toBe('<p>z</p>\n<p><abbr title="x y">A</abbr></p>')
  })

  it('joins an indented line of any shape onto the expansion', () => {
    expect(render('*[A]: x\n  - y\n  # z\n\nA\n')).toBe('<p><abbr title="x - y # z">A</abbr></p>')
  })

  it('reads a CRLF tail line', () => {
    expect(format('[a]: /u\r\n  "T"\r\n\r\nSee [a].\r\n')).toBe('[a]: /u "T"\n\nSee [a].\n')
  })
})
