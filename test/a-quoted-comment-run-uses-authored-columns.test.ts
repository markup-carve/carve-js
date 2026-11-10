import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('refuses a quoted comment run whose unspaced continuations start before its brace (carve-js#4859)', () => {
  expect(carveToHtml('> {% a\n>b\n>z %} y\n')).toBe('<blockquote><p>{% a\n&gt;b\n&gt;z %} y</p></blockquote>')
})
