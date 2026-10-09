import { expect, test } from 'vitest'
import { djotToCarve, carveToHtml } from '../src/index.js'

test.each([
  ['{#id} at beginning\n', '<p> at beginning</p>'],
  ['After {#id} space\n{.class}\n', '<p>After  space\n</p>'],
  ['not a [span] {#id}.\n', '<p>not a [span] .</p>'],
  ['{#id .class}\n\nA paragraph\n', '<p>A paragraph</p>'],
  ['[span]{#id}', '<p><span id="id">span</span></p>'],
  ['`x`{.c}', '<p><code class="c">x</code></p>'],
  ['<http://x.y>{.c}', '<p><a href="http://x.y" class="c">http://x.y</a></p>'],
])('Djot attribute ownership: %s', (source, expected) => {
  expect(carveToHtml(djotToCarve(source)).trim()).toBe(expected)
})

test.each(['```\nx\n```', '::: box\nx\n:::', '***', '| a |', '[r]: /u'])('keeps pending attributes after a closed block: %s', block => {
   expect(carveToHtml(djotToCarve(`${block}\n{.c}\npara`))).toContain('<p class="c">para</p>')
 })
