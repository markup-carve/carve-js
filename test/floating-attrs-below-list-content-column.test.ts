import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('floating attributes at list content columns', () => {
  it.each([
    ['bullet', '-{#k} {#h}\n # h\n', '<ul>\n  <li id="k"></li>\n</ul>\n<section id="h">\n  <h1>h</h1>\n</section>'],
    ['ordered', '1.{#k} {#h}\n  # h\n', '<ol>\n  <li id="k"></li>\n</ol>\n<section id="h">\n  <h1>h</h1>\n</section>'],
    [
      'task',
      '-{#k} [x] {#h}\n # h\n',
      '<ul class="task-list">\n  <li data-task-state="x" id="k"><input type="checkbox" checked disabled> </li>\n</ul>\n<section id="h">\n  <h1>h</h1>\n</section>',
    ],
  ])('closes an attribute-only %s item before a below-column heading', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it('attaches the floating attribute when the heading reaches the content column', () => {
    expect(carveToHtml('-{#k} {#h}\n  # h\n')).toBe(
      '<ul>\n  <li id="k">\n    <h1 id="h">h</h1>\n  </li>\n</ul>',
    )
  })

  it('ends the item at a below-column heading when marker-line text opened a paragraph', () => {
    expect(carveToHtml('-{#k} text\n # h\n')).toBe('<ul>\n  <li id="k">text</li>\n</ul>\n<section id="h">\n  <h1>h</h1>\n</section>')
  })
})
