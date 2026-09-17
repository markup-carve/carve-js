import { describe, expect, it } from 'vitest'
import { htmlToCarve } from '../src/index.js'

// A reader learns an element is gone before its attributes are, the order
// carve-php#1737 settled.

describe('the report for an unwrapped element with a dropped attribute', () => {
  it.each(['q', 'small', 'span', 'section', 'font', 'center'])('lists the element row first for <%s>', (tag) => {
    const codes = htmlToCarve(`<p><${tag} onclick="x">hi</${tag}></p>`).report.diagnostics.map((d) => d.code)
    expect(codes).toEqual(['element-unwrapped', 'attribute-dropped'])
  })

  it('keeps document order across elements', () => {
    const codes = htmlToCarve('<p><small onclick="x">a</small><font>b</font></p>').report.diagnostics.map((d) => d.path)
    expect(codes).toEqual(['/p[1]/small[1]', '/p[1]/small[1]', '/p[1]/font[2]'])
  })
})
