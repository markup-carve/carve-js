import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('floating attributes at list content columns', () => {
  it.each([
    ['bullet', '-{#k} {#h}\n # h\n', '<ul>\n  <li id="k"></li>\n</ul>\n<p># h</p>'],
    ['ordered', '1.{#k} {#h}\n  # h\n', '<ol>\n  <li id="k"></li>\n</ol>\n<p># h</p>'],
    [
      'task',
      '-{#k} [x] {#h}\n # h\n',
      '<ul>\n  <li id="k"><input type="checkbox" checked disabled> </li>\n</ul>\n<p># h</p>',
    ],
  ])('closes an attribute-only %s item before a below-column heading', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it('attaches the floating attribute when the heading reaches the content column', () => {
    expect(carveToHtml('-{#k} {#h}\n  # h\n')).toBe(
      '<ul>\n  <li id="k">\n    <h1 id="h">h</h1>\n  </li>\n</ul>',
    )
  })

  it('keeps lazy folding when marker-line text opened a paragraph', () => {
    expect(carveToHtml('-{#k} text\n # h\n')).toBe('<ul>\n  <li id="k">text\n# h</li>\n</ul>')
  })
})
