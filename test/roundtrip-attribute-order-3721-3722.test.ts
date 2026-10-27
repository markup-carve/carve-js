import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('places a generated heading ID carrier before the generated ID', () => {
  expect(carveToHtml('> # a', { roundtrip: true })).toBe(
    '<blockquote>\n  <h1 data-carve-generated-id="1" id="a">a</h1>\n</blockquote>',
  )
  expect(carveToHtml('# a', { roundtrip: true })).toBe(
    '<section data-carve-generated-id="1" id="a">\n  <h1>a</h1>\n</section>',
  )
})

it('places a code-fence label carrier after the title', () => {
  expect(carveToHtml('``` "t" [L]\n```', { roundtrip: true })).toBe(
    '<pre title="t" data-carve-label="L"><code></code></pre>',
  )
})
