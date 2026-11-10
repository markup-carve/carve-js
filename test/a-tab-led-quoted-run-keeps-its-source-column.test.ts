import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  ['an unprefixed continuation', '> \t{.x\n     .y}\nplain\n'],
  ['a prefixed continuation', '> \t{.x\n>      .y}\nplain\n'],
  ['a padded opener', '>  {.x\n     .y}\nplain\n'],
])('closes a tab-led or padded quoted attribute run with %s (carve#5796)', (_name, source) => {
  expect(carveToHtml(source)).toBe('<blockquote>\n\n</blockquote>\n<p>plain</p>')
})

it('closes a nested run through a continuation under fewer quote markers', () => {
  expect(carveToHtml('> > {.x\n>    .y}\n')).toBe('<blockquote>\n  <blockquote>\n\n  </blockquote>\n</blockquote>')
})

it('keeps a tab-led run continued at its brace column as paragraph text', () => {
  expect(carveToHtml('> \t{.x\n    .y}\nplain\n')).toBe('<blockquote><p>{.x\n.y}\nplain</p></blockquote>')
})

it.each([
  ['heading', '> \t# h\nx\n', '<blockquote>\n  <h1 id="h">h</h1>\n</blockquote>\n<p>x</p>'],
  ['code fence', '> \t```\ncode\n', '<blockquote>\n  <pre><code></code></pre>\n</blockquote>\n<p>code</p>'],
])('reads a %s behind a tab after the quote marker as that block', (_name, source, expected) => {
  expect(carveToHtml(source)).toBe(expected)
})
