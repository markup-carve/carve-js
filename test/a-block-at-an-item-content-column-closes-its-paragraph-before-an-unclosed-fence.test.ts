import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const render = (lines: string[]): string =>
  carveToHtml(['::: note', ...lines, '```', 'code', '::::', ':::', 'after *b*', ''].join('\n'))
// An unclosed fence interrupts the item and its payload is opaque, so `:::` cannot close the div (carve#4018).
const runsToEnd = '  <pre><code>code\n::::\n:::\nafter *b*\n</code></pre>\n</aside>'

it.each([
  ['a link definition', ['- para', '  [r]: /u']],
  ['a definition at the outer item column', ['- a', '  - para', '  [r]: /u']],
  ['a table row', ['- para', '  | t |']],
  ['an ordered item table row', ['10. para', '    | t |']],
  ['a quoted item table row', ['> - para', '>   | t |']],
  ['a nested item table row', ['- a', '  - para', '    | t |']],
  ['a task item table row', ['- [ ] para', '  | t |']],
  ['a table row past the column', ['- para', '    | t |']],
  ['an attribute line', ['- para', '  {#x}']],
  ['a heading', ['- para', '  # H']],
  ['a heading past the column', ['- para', '   # H']],
  ['a thematic break', ['- para', '  ---']],
  ['a table row under an attributed marker', ['-{#x} para', '  | t |']],
  ['a table row under an attributed ordered marker', ['1.{#x} para', '   | t |']],
])('%s at the item content column closes the paragraph, and the unclosed fence runs to the end', (_name, lines) => {
  expect(render(lines).trimEnd().endsWith(runsToEnd)).toBe(true)
})

it('a footnote definition at the item content column does not take the fence lines as note text', () => {
  expect(render(['- para', '  [^f]: n']).trimEnd().endsWith(runsToEnd)).toBe(true)
})

it.each([
  ['a definition below the column', ['- para', ' [r]: /u']],
  ['a definition below the column of an item with trailing spaces', ['- para  ', ' [r]: /u']],
  ['a table row below the column', ['10. para', '   | t |']],
])('%s closes the paragraph too, and the unclosed fence runs to the end', (_name, lines) => {
  expect(render(lines).trimEnd().endsWith(runsToEnd)).toBe(true)
})

it.each([
  ['item prose after a table row', ['- para', '  | t |', '  more']],
])('control: %s leaves a paragraph open, and the fence still interrupts it', (_name, lines) => {
  expect(render(lines)).toContain('      more\n    </li>\n  </ul>\n  <pre><code>code\n::::\n:::\nafter *b*\n</code></pre>')
})
