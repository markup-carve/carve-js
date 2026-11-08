import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('reads a quoted note marker-line plus follower as one closed code fence', () => {
  for (const quote of ['> ', '> > ']) for (const margin of [2, 3, 4, 5]) for (const fence of ['```', '~~~']) {
    const line = (content: string) => `${quote}${' '.repeat(margin)}${content}`
    const source = `${quote}[^m]: +\n${line(fence)}\n${line('x')}\n${line(fence)}\n\nsee[^m]\n`
    const html = carveToHtml(source)
    expect(html).toContain('<pre><code>x\n</code></pre>')
    expect(html).not.toContain('<p><code>')
  }
})
