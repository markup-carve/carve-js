import { describe, expect, it } from 'vitest'
import { render } from '../src/index.ts'

// carve#6762 (C2-H-043): a line block writes its runs of spaces and tabs with their columns, as 0.1 did.
const line = (body: string): string => render(`::: |\n${body}\n:::\n`).split('\n')[1]!.trim()

describe('verse whitespace in a line block (C2-H-043)', () => {
  it.each([
    ['a\tb', '<p>a&nbsp;&nbsp;&nbsp;b</p>'],
    ['abc\td', '<p>abc d</p>'],
    [' a', '<p>&nbsp;a</p>'],
    ['😀\tx', '<p>😀&nbsp;&nbsp;&nbsp;x</p>'],
    ['a &  <b', '<p>a &amp;&nbsp;&nbsp;&lt;b</p>'],
    ['*a  b*  c', '<p><strong>a&nbsp;&nbsp;b</strong>&nbsp;&nbsp;c</p>'],
    ['*a* b', '<p><strong>a</strong> b</p>'],
    ['$`a  b`', '<p><span class="math inline" role="math">\\(a  b\\)</span></p>'],
  ])('%j', (body, html) => {
    expect(line(body)).toBe(html)
  })

  it('leaves the spaces of a paragraph alone', () => {
    expect(render('a  b\tc\n')).toBe('<p>a  b\tc</p>')
  })
})
