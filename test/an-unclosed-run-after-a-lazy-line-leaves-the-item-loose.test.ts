import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

const cases = [
  ['backtick', '- o\n  ```\nx\n\n  t\n'],
  ['tilde', '- o\n  ~~~\nx\n\n  t\n'],
  ['ordered', '1. o\n   ```\nx\n\n   t\n'],
] as const

describe('an unclosed run followed by a below-column lazy line', () => {
  for (const [name, source] of cases) {
    it(`ends a tight item at the below-column line: ${name}`, () => {
      expect(parse(source).children[0]).toMatchObject({ type: 'list', tight: true })
      const html = carveToHtml(source)
      expect(html).toContain('<li>o\n    <pre><code></code></pre>')
      expect(html).toContain('<p>t</p>')
    })
  }

  it('does not fold a marker-line fence', () => {
    const source = '- ```\nx\n\n- n\n'
    expect(carveToHtml(source)).toContain('<pre><code>')
  })
})
