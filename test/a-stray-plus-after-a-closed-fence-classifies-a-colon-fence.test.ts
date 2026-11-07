import { expect, it } from 'vitest'
import { carveToHtml, lintCarve, parse } from '../src/index.js'

// carve-js#4649: the stray `+` classifies its follower before the line sets
// `reach`, and the closer before it popped the fence frame `reach` still named.
const source = '```\n```\n+\n:::\n'

it('renders a stray plus between a closed fence and a colon fence', () => {
  expect(carveToHtml(source)).toBe(`<pre><code></code></pre>
<p>+</p>
<div>

</div>`)
})

it('parses and lints the same input without throwing', () => {
  expect(() => parse(source)).not.toThrow()
  expect(() => lintCarve(source, {})).not.toThrow()
})

for (const fence of ['~~~\n~~~', '```\nx\n```', '%%%\n%%%', '::: a\n:::']) {
  it(`renders a stray plus after ${JSON.stringify(fence)} before a colon fence`, () => {
    expect(() => carveToHtml(`${fence}\n+\n::: x\n`)).not.toThrow()
  })
}
