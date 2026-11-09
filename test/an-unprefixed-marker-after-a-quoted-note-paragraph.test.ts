import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('an unprefixed marker after a quoted note paragraph', () => {
  it.each(['a. li', 'b. li', 'word'])('leaves the quote after %j', prose => {
    const html = carveToHtml(`> [^a]: x\n> ${prose}\n- y\n\nref[^a]\n`)
    expect(html).toContain('</blockquote>\n<ul>\n  <li>y</li>\n</ul>')
    expect(html).toContain(`      <p>x\n${prose}<a href="#fnref1"`)
  })
})
