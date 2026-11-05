/*
 * carve-js#4434: after a refused brace run, a fence opener keeps its closer in
 * the paragraph whatever info string it carries (CARVE-P2-035).
 */
import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const quoted = '<blockquote><p>z</p></blockquote>'

describe('a fence opener after a refused brace run', () => {
  it.each(['```py', '``` py', '```py "t"', '```py [l]', '``` =html', '~~~ js'])('keeps the closer of %s', (opener) => {
    const closer = opener.startsWith('~') ? '~~~' : '```'
    const body = opener.startsWith('~') ? `${opener}\nk\n~~~` : `<code>${opener.slice(3)}\nk\n</code>`
    expect(carveToHtml(`{x\ny}\n${opener}\nk\n${closer}\n> z\n`).trim()).toBe(`<p>{x\ny}\n${body}</p>\n${quoted}`)
  })

  it('keeps the closer in an item after a plus', () => {
    const html = carveToHtml('- a\n+\n  {x\n  y}\n  ```py\n  k\n  ```\n  > z\n')
    expect(html).toContain('<code>py\nk\n</code>\n    ' + quoted)
    expect(html).not.toContain('<pre>')
  })
})
