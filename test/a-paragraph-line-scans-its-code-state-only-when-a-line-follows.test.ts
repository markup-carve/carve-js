import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A paragraph scans a line's open code and comment state when the next line reads it (carve-js#5021).
describe('a paragraph line scans its code state only when a line follows', () => {
  it('holds a brace line inside a code span opened on an earlier line', () => {
    expect(carveToHtml('a `x\n{.c}\nb`\n')).toBe('<p>a <code>x\n{.c}\nb</code></p>')
  })

  it('holds the brace line when plain lines come before the code opener', () => {
    expect(carveToHtml('plain\nplain\na `x\n{.c}\nb`\n')).toBe('<p>plain\nplain\na <code>x\n{.c}\nb</code></p>')
  })

  it('lets a backtick inside an accepted attribute open no code span', () => {
    expect(carveToHtml('a [s]{k="`"}\n{.c}\nb\n')).toBe('<p>a <span k="`">s</span></p>\n<p class="c">b</p>')
  })

  it('reads an attribute on a bare closer before a later code opener', () => {
    expect(carveToHtml('*s*{k="`"} and `y\n{.c}\nz`\n'))
      .toBe('<p><strong k="`">s</strong> and <code>y\n{.c}\nz</code></p>')
  })

  it('holds a brace line inside an open comment span', () => {
    expect(carveToHtml('a {%x\n{.c}\n%} b\n')).toBe('<p>a  b</p>')
  })
})
