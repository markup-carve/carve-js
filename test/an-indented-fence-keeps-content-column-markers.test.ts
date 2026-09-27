import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

describe('an indented fence keeps content-column markers (#2212)', () => {
  for (const fence of ['```', '~~~']) {
    for (const marker of ['- second', '1. second', '- [x] second', '-{.c} second']) {
      for (const [host, column] of [['- head', 2], ['1. head', 3], ['- [x] head', 2], ['- - head', 4]] as const) {
        it(`${host}: ${fence} keeps ${marker} as payload`, () => {
          const src = `${host}\n\n${' '.repeat(column + 4)}${fence}\n${' '.repeat(column + 4)}a\n${' '.repeat(column)}${marker}\n`
          const html = carveToHtml(src)
          expect(html).toContain(`<pre><code>a\n${marker}\n</code></pre>`)
          const written = carveToCarve(src)
          expect(carveToHtml(written)).toBe(html)
          expect(carveToCarve(written)).toBe(written)
        })
      }
    }
  }

  it.each([1, 2, 3])('keeps payload with an opener %i columns past a term lead', (extra) => {
    const pad = ' '.repeat(2 + extra)
    const src = `- :: term\n\n${pad}\`\`\`\n${pad}a\n  - second\n`
    expect(carveToHtml(src)).toContain('<pre><code>a\n- second\n</code></pre>')
  })

  it('keeps the marker inside a quoted item', () => {
    expect(carveToHtml('> - head\n>\n>       ```\n>       a\n>   - second\n'))
      .toContain('<pre><code>a\n- second\n</code></pre>')
  })

  it('keeps raw-fence payload', () => {
    expect(carveToHtml('- head\n\n      ```=html\n      a\n  - second\n'))
      .toContain('a\n- second\n')
  })

  it('recognises a sublist after the authored closer', () => {
    const src = '- head\n\n      ```\n      a\n  - payload\n      ```\n  - second\n'
    const html = carveToHtml(src)
    expect(html).toContain('<pre><code>a\n- payload\n</code></pre>')
    expect(html).toContain('<li>second</li>')
  })

  it('keeps plain text at the same column as payload', () => {
    expect(carveToHtml('- head\n\n      ```\n      a\n  second\n'))
      .toContain('<pre><code>a\nsecond\n</code></pre>')
  })
})
