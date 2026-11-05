import { expect, it } from 'vitest'
import { parse, carveToHtml } from '../src/index.js'

it('opens a table after lazy text in a nested footnote body', () => {
  const source = '[r][] [^p] [^c] [^d]\n\n[^c]: [^d]: para\n        more\n         | a |\n\ntail\n'
  expect(parse(source).footnoteDefs?.d?.map(block => block.type)).toEqual(['paragraph', 'table'])
  expect(carveToHtml(source)).toContain('<p>para\nmore</p>\n      <table>')
})

it('keeps indentation in a nested footnote fence payload', () => {
  const source = 'x[^a] [^b]\n\n[^a]: [^b]: ```\n           # indented\n           ```\n'
  expect(carveToHtml(source)).toContain('<pre><code>   # indented\n   ```\n</code></pre>')
})
