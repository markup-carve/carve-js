import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('opens a code block in a box after a closed nested line block', () => {
  const source = '> - ::: box\n>   - ::: |\n>     ```\n>     :::\n>    ```\n>    :::bad\n>    :::\n- tail'
  const html = carveToHtml(source)
  expect(html).toContain('<pre><code>')
})

it('keeps deeper colon runs as code after a closed quoted child', () => {
  const source = '> - ::: box\n>   -   ::: |\n>       ```\n>       :::\n>     ```\n>     :::\n>     :::bad\n>     :::\n- tail\n'
  expect(carveToHtml(source)).toContain('<pre><code>')
})

it('ends a quote after unclosed child and outer item fences', () => {
  const source = '> - a\n>     - child\n>     ```\n>\n>       ```\n>   ~~~\nafter\n'
  const html = carveToHtml(source)
  expect(html).toContain('</blockquote>\n<p>after</p>')
  expect(html.match(/<pre><code>/g)).toHaveLength(2)
})

it('does not revive a child paragraph after its code fence closes', () => {
  const source = '- a\n    - child\n      ```\n      x\n      ```\n    ```\nafter\n'
  expect(carveToHtml(source)).toContain('<pre><code>after\n</code></pre>')
})

it.each([
  '- a\n    - ```\n      x\n    ```\nafter\n',
  '- a\n    - child\n      - # h\n    ```\nafter\n',
  '- a\n    - child\n\n        - g\n\n          ```\n          x\n          ```\n    ```\nafter\n',
])('does not retain a child paragraph after structural content', source => {
  expect(carveToHtml(source)).toContain('<pre><code>after\n</code></pre>')
})
