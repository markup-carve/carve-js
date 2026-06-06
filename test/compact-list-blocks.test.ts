import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * Compact list blocks (A1) + list-continuation marker (A3) -- Carve dialect,
 * always on. A blank line before a sub-block no longer loosens the item, and a
 * lone `+` at the marker column attaches the following flush-left block to the
 * item. Both keep the list tight; canonical djot would render these loose.
 */
describe('compact list blocks (A1)', () => {
  it('a blank line before a sub-block keeps the item tight', () => {
    expect(carveToHtml('- item\n\n  > note\n- next')).toBe(
      '<ul>\n  <li>item\n    <blockquote><p>note</p></blockquote>\n  </li>\n  <li>next</li>\n</ul>',
    )
  })

  it('a fenced code block after a blank stays tight', () => {
    const html = carveToHtml('- run\n\n  ```sh\n  make\n  ```\n- next')
    expect(html).toContain('<li>run\n    <pre>')
    expect(html).not.toContain('<li><p>run</p>')
  })

  it('a real second paragraph still loosens the list', () => {
    const html = carveToHtml('- item\n\n  second para\n- next')
    expect(html).toContain('<li><p>item</p>')
    expect(html).toContain('<p>second para</p>')
  })

  it('a blank line between items still loosens the list', () => {
    expect(carveToHtml('- a\n\n- b')).toContain('<li><p>a</p></li>')
  })
})

describe('list continuation marker (A3)', () => {
  it('a `+` line attaches a flush-left code block, tight', () => {
    const html = carveToHtml('- Build\n+\n```sh\nmake\n```\n- Push')
    expect(html).toContain('<li>Build\n    <pre><code class="language-sh">make\n</code></pre>')
    expect(html).toContain('<li>Push</li>')
  })

  it('a `+` line attaches a blockquote, tight', () => {
    expect(carveToHtml('- item\n+\n> note\n- next')).toBe(
      '<ul>\n  <li>item\n    <blockquote><p>note</p></blockquote>\n  </li>\n  <li>next</li>\n</ul>',
    )
  })

  it('a bare `+` outside a list is literal paragraph text', () => {
    expect(carveToHtml('para\n\n+\n\nnext')).toContain('<p>+</p>')
  })

  it('`+` is no longer a bullet, so a `+ x` line is literal paragraph text', () => {
    expect(carveToHtml('+ one\n+ two')).toBe('<p>+ one\n+ two</p>')
  })
})
