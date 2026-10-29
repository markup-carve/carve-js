import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('definition body fence lookahead at its source column', () => {
  it('opens a fence after the description at a fence-shaped run', () => {
    const html = carveToHtml(':: t\n: d\n ```\nx\n```')
    expect(html).toBe('<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>\n<pre><code>x\n</code></pre>')
  })

  it.each(['```', '~~~~'])('does not take a left-of-base closer for %s', run => {
    const html = carveToHtml(`:: t\n: d\n ${run}\nx\n${run}`)
    expect(html).toContain('<dd>d')
    expect(html).toContain('</dd>\n</dl>')
  })
})
