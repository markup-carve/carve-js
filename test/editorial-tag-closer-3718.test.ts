import { expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

it.each([
  ['{-{#x-}', '<p><del>{<span class="tag"><strong>#x</strong></span></del></p>'],
  ['{+{#x+}', '<p><ins>{<span class="tag"><strong>#x</strong></span></ins></p>'],
  ['{-{#alpha-beta-}', '<p><del>{<span class="tag"><strong>#alpha-beta</strong></span></del></p>'],
  ['{-{.x-}', '<p><del>{.x</del></p>'],
  ['{-{#x} a-}', '<p><del>{<span class="tag"><strong>#x</strong></span>} a</del></p>'],
])('keeps an editorial closer outside attribute-shaped text: %s', (source, expected) => {
  expect(renderHtml(parse(source))).toBe(expected)
})
