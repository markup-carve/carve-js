import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a note-owned lazy line before the first visible item child', () => {
  it('does not loosen the list across the following blank (carve#4765)', () => {
    const source = 'r[^n]\n\n- [^n]: x\n  Body.\n\n  Two.\n'
    const html = carveToHtml(source)
    expect(html).toContain('<ul>\n  <li>Two.</li>\n</ul>')
    expect(html).toContain('<p>x\nBody.<a href="#fnref1"')
  })

  it('still loosens after visible item content', () => {
    const source = '- [^n]: x\n  Body.\n  # Item\n\n  Two.\n'
    expect(carveToHtml(source)).toContain('<li>\n    <h1 id="Item">Item</h1>\n    <p>Two.</p>\n  </li>')
  })
})
