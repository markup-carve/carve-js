import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('removes the whole available prefix left of an authored-base fence', () => {
  const source = '- ::: box\n     ```\n    x\n     y\n  :::\nafter\n'
  // The unclosed fence's payload is opaque, so `:::` is payload (carve#4018).
  expect(carveToHtml(source)).toContain('<pre><code>x\ny\n:::\n</code></pre>')
})

it('ends the list after a child with a closed code fence', () => {
  const source = '- a\n    - child\n      ```\n      x\n      ```\n  ~~~\nafter\n'
  expect(carveToHtml(source)).toMatch(/<\/ul>\n<p>after<\/p>$/)
})

it('ends the list after a child heading at the same boundary', () => {
  const source = '- a\n    - # h\n  ~~~\nafter\n'
  expect(carveToHtml(source)).toMatch(/<\/ul>\n<p>after<\/p>$/)
})

it('removes the prefix in a definition body too', () => {
  const source = ':: t\n: x\n\n     ```\n    a\n     b\n     ```\n'
  expect(carveToHtml(source)).toContain('<pre><code>a\nb\n</code></pre>')
})
