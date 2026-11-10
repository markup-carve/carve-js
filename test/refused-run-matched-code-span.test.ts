import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a fence after a refused brace run in an attached note (carve#5830)', () => {
  it('opens a code block that keeps a list marker', () => {
    const source = '[^a]: +\n{.x\n.y}\n```\nwa\n- li\n```\n\nsee[^a]\n'
    expect(carveToHtml(source)).toBe('<pre><code>wa\n- li\n</code></pre>\n<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>{.x\n.y}<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>')
  })

  it('keeps block-shaped lines in the code block across note variants', () => {
    let checked = 0
    for (const label of ['a', 'b', 'long', 'x'])
      for (const opener of ['```', '````', '`````', '``````', '```````'])
        for (const payload of ['wa', 'text', 'abc', '123', 'x'])
          for (const marker of ['- li', '* li', '1. li', '- x', '* x', '1. x', '- z', '* z', '1. z', '- sibling']) {
            const source = `[^${label}]: +\n{.x\n.y}\n${opener}\n${payload}\n${marker}\n${opener}\n\nsee[^${label}]\n`
            const html = carveToHtml(source)
            expect(html).toContain(`<pre><code>${payload}\n${marker}\n</code></pre>`)
            expect(html).toContain('<section role="doc-endnotes"')
            checked++
          }
    expect(checked).toBe(1000)
  })

  it('closes the code block at a longer backtick run', () => {
    const html = carveToHtml('- a\n+\n{x\ny}\n```\nwa\n- b\n````\n')
    expect(html).toContain('<pre><code>wa\n- b\n</code></pre>')
    expect(html).not.toContain('<li>b</li>')
  })
})
