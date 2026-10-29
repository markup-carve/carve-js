import { describe, expect, it } from 'vitest'
import { parse, carveToHtml } from '../src/index.js'

const cases = [
  ['bullet', '- o\n  - h\n  ```\n\n  t\n'],
  ['tilde', '- o\n  - h\n  ~~~\n\n  t\n'],
  ['ordered outer item', '1. o\n   - h\n   ```\n\n   t\n'],
  ['quoted item', '> - o\n>   - h\n>   ```\n>\n>   t\n'],
] as const

describe('a fence after a child list opens in the parent and runs to its end (carve#4018)', () => {
  for (const [name, source] of cases) {
    it(name, () => {
      const document = parse(source)
      const outer = name === 'quoted item' ? document.children[0]?.type === 'block_quote' ? document.children[0].children[0] : undefined : document.children[0]
      expect(outer?.type).toBe('list')
      if (outer?.type !== 'list') return
      expect(outer.tight).toBe(true)
      const html = carveToHtml(source)
      expect(html).not.toContain('<p>o</p>')
      expect(html).toContain('<pre><code>\nt\n</code></pre>')
    })
  }

  it('keeps a real closed fence distinct from the folded run', () => {
    const source = '- o\n  - h\n  ```\n  ```\n\n  t\n'
    expect(parse(source).children[0]).toMatchObject({ type: 'list', tight: false })
    expect(carveToHtml(source)).toContain('<pre><code></code></pre>')
  })

  it('keeps a dedent-ended child fence open through its payload blank', () => {
    const source = '- outer\n  - head\n\n    ```\n    a\n  ```\n\n  tail\n- next\n'
    expect(parse(source).children[0]).toMatchObject({ type: 'list', tight: true })
  })
})
