import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a colon fence on a marker line opens without a body', () => {
  const html = (src: string) => carveToHtml(src).trim()

  it('opens an empty container for every colon kind', () => {
    expect(html('* ::: x\n~\n')).toBe("<ul>\n  <li>\n    <div class=\"x\">\n\n    </div>\n  </li>\n</ul>\n<p>~</p>")
    expect(html('* ::: note\n~\n')).toBe("<ul>\n  <li>\n    <aside class=\"admonition note\" aria-label=\"Note\">\n\n    </aside>\n  </li>\n</ul>\n<p>~</p>")
    expect(html('* ::: |\n~\n')).toBe("<ul>\n  <li>\n    <div class=\"line-block\">\n\n    </div>\n  </li>\n</ul>\n<p>~</p>")
    expect(html('* ::: >\n~\n')).toBe("<ul>\n  <li>\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ul>\n<p>~</p>")
    expect(html('* ::: \\\n~\n')).toBe("<ul>\n  <li>\n    <div class=\"hardbreaks\">\n\n    </div>\n  </li>\n</ul>\n<p>~</p>")
  })

  it('still opens the block when a body line reaches the content column', () => {
    expect(html('* ::: |\n  ~\n')).toBe(
      '<ul>\n  <li>\n    <div class="line-block">\n      <p>~</p>\n    </div>\n  </li>\n</ul>',
    )
    expect(html('* ::: >\n  ~\n')).toBe(
      '<ul>\n  <li>\n    <blockquote><p>~</p></blockquote>\n  </li>\n</ul>',
    )
    expect(html('* ::: \\\n  ~\n')).toBe(
      '<ul>\n  <li>\n    <div class="hardbreaks">\n      <p>~</p>\n    </div>\n  </li>\n</ul>',
    )
  })

  it('reads the same off a dash marker, and with the fence closed in the item', () => {
    expect(html('- ::: |\n~\n')).toBe("<ul>\n  <li>\n    <div class=\"line-block\">\n\n    </div>\n  </li>\n</ul>\n<p>~</p>")
    expect(html('* ::: |\n  ~\n  :::\n')).toBe(
      '<ul>\n  <li>\n    <div class="line-block">\n      <p>~</p>\n    </div>\n  </li>\n</ul>',
    )
  })
})
