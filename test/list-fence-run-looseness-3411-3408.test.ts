import { describe, expect, it } from 'vitest'
import { parse, carveToHtml } from '../src/index.js'

const cases = [
  ['3411 outer closer', '- o\n  - h\n  ```\n  ```\n  ~~~\n\n  t\n', true],
  ['3408 lazy text', '- o\n  ```\nx\n\n  t\n', false],
  ['3408 column zero', '- o\n```\nx\n\n  t\n', false],
  ['641 lazy line', '- o\n  ```\nx\n\n  t\n', false],
  ['641 outer closer', '- h\n  ```\n\n  b\n```\n', false],
  ['ordered marker', '1. o\n   - h\n   ```\n\n   t\n', false],
  ['quote wrapper', '> - o\n>   - h\n>   ```\n>\n>   t\n', false],
  ['longer outer closer', '- o\n  - h\n  ```\n  ````\n  ~~~\n\n  t\n', true],
  ['head1 child and outer', '- o\n  - head1\n    ````\n  ```\n  ````\n\n  t\n', false],
  ['payload between runs', '- o\n  - h\n  ```\n  payload\n  ```\n  ~~~\n\n  t\n', true],
  ['third depth', '- o\n  - h\n    - d\n  ```\n  ```\n  ~~~\n\n  t\n', true],
  ['outer sibling', '- o\n  - h\n  ```\n  ```\n  ~~~\n\n  t\n- next\n', true],
  ['backtick after tilde', '- o\n  - h\n  ~~~\n  ~~~\n  ```\n\n  t\n', true],
  ['info string', '- o\n  - h\n  ```js\n  ```\n  ~~~\n\n  t\n', true],
  ['more lazy text', '- o\n  ```\nx\ny\n\n  t\n', false],
  ['intervening same-character pair', '- o\n  - h\n  ```\n  ```\n  ```\n  ```\n\n  t\n', false],
] as const

function list(source: string) {
  const first = parse(source).children[0]
  return first?.type === 'block_quote' ? first.children[0] : first
}

describe('list fence run looseness', () => {
  for (const [name, source, tight] of cases) {
    it(name, () => {
      expect(list(source)).toMatchObject({ type: 'list', tight })
      const html = carveToHtml(source)
      expect(html).toContain('<li>')
      if (name === '3411 outer closer') {
        expect(html).toContain('<li>h</li>')
        expect(html).toContain('<pre><code></code></pre>')
        expect(html).toContain('<pre><code>\nt\n</code></pre>')
      } else if (name === '3408 lazy text') {
        expect(html).toContain('<code>\nx</code>')
        expect(html).toContain('<p>t</p>')
      }
    })
  }
})
