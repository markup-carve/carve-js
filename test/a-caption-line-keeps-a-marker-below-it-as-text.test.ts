import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'

describe('a marker line below a caret line', () => {
  it('leaves later indented blocks out of the paragraph', () => {
    expect(carveToHtml('^ p\n- x\n  > q\n')).toBe('<p>^ p\n- x</p>\n<blockquote><p>q</p></blockquote>')
  })

  it('opens a list at a below-column marker after an item paragraph that starts with a caret', () => {
    expect(carveToHtml('- ^ c\n 1. x\n')).toBe('<ul>\n  <li>^ c</li>\n</ul>\n<ol>\n  <li>x</li>\n</ol>')
  })

  it.each([
    ['^ p\n- x\n  # h\n', '<p>^ p\n- x</p>\n<section id="h">\n  <h1>h</h1>\n</section>'],
    ['> ^ p\n> - x\n>   > q\n', '<blockquote>\n  <p>^ p\n- x</p>\n  <blockquote><p>q</p></blockquote>\n</blockquote>'],
    ['| a |\n^ p\n- x\n  > q\n', '<table>\n  <caption>p\n- x</caption>\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>\n<blockquote><p>q</p></blockquote>'],
  ])('%j', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it('still attaches an indented caption to its image', () => {
    expect(carveToHtml(' ![a](p.png)\n ^ cap\n')).toContain('<figure>')
  })
})
