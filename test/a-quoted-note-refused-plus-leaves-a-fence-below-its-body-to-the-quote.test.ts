import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve-js#4712: a fence one column right of the note marker is refused and stays the quote's block.
it('keeps a fence one column right of a quoted note marker whole in the quote', () => {
  for (const quote of ['> ', '> > ']) for (const fence of ['```', '~~~', '````']) for (const payload of ['x', '%% c']) {
    const line = (content: string) => `${quote} ${content}`
    const source = `${quote}[^m]: +\n${line(fence)}\n${line(payload)}\n${line(fence)}\n\nsee[^m]\n`
    const html = carveToHtml(source)
    expect(html).toContain(`<pre><code>${payload}\n</code></pre>`)
    expect(html.split('<pre>').length).toBe(2)
    expect(html.indexOf('<pre>')).toBeLessThan(html.indexOf('</blockquote>'))
  }
})

it('still gives the note a paragraph one column right of its marker', () => {
  const html = carveToHtml('> [^m]: +\n>  x\n\nsee[^m]\n')
  expect(html).toContain('<li id="fn1">\n      <p>x<a')
})

it('reads a tab-indented block follower of a refused quoted note plus as that block', () => {
  const html = carveToHtml('> [^m]: +\n> \t# head\n\nsee[^m]\n')
  expect(html).toContain('<h1 id="head">head</h1>')
})
