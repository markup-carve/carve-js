import { expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'

it.each([
  ['| word{title="a|b"} |', 'word'],
  ['| [x]{title="a|b"} |', '<span>x</span>'],
  ['[r]: /u\n\n| [x][r]{title="a|b"} |', '<a href="/u">x</a>'],
  ['| [x](/u){title="a|b"} |', '<a href="/u">x</a>'],
])('keeps attributes from crossing table cells: %s', (source, content) => {
  expect(carveToHtml(djotToCarve(source))).toContain(`<tr><td>${content}{title=“a</td><td>b”</td></tr>`)
})

it('keeps escaped attribute pipes inside their cell', () => {
  expect(carveToHtml(djotToCarve('| [x]{title="a\\|b"} |'))).toContain('<tr><td><span title="a|b">x</span></td></tr>')
})

it('leaves attribute-shaped code opaque', () => {
  expect(carveToHtml(djotToCarve('| `word{title="a|b"}` |'))).toContain('<tr><td><code>word{title="a|b"}</code></td></tr>')
})

it.each(['', '> ', '- ', '> - '])('preserves escaped pipe destinations in %s tables', prefix => {
  expect(carveToHtml(djotToCarve(prefix + '| [x](u\\|v) |'))).toContain('<a href="u|v">x</a>')
})

it('reserves existing reference names when lifting pipe destinations', () => {
  const source = '[carve-djot-pipe-target-1]: /existing\n\n| [x](u\\|v) |\n\n[y][carve-djot-pipe-target-1]'
  const html = carveToHtml(djotToCarve(source))
  expect(html).toContain('<a href="u|v">x</a>')
  expect(html).toContain('<a href="/existing">y</a>')
})
