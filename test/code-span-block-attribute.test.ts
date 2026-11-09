import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('block attributes inside an open code span', () => {
  it.each([
    ['root paragraph', 'p\n`open\n{.x}\nclose`\nz\n', '<p>p\n<code>open\n{.x}\nclose</code>\nz</p>'],
    ['closing line', 'p\n`open\n{.x}\n`\n', '<p>p\n<code>open\n{.x}\n</code></p>'],
    ['quote', '> p\n> `open\n> {.x}\n> close`\n> z\n', '<blockquote><p>p\n<code>open\n{.x}\nclose</code>\nz</p></blockquote>'],
    ['list item', '- p\n  `open\n  {.x}\n  close`\n  z\n', '<ul>\n  <li>p\n<code>open\n{.x}\nclose</code>\nz</li>\n</ul>'],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
