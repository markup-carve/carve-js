import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const render = (lines: string[]): string =>
  carveToHtml(['::: note', ...lines, '```', 'code', '::::', ':::', 'after *b*', ''].join('\n'))
const endsAtCloser = '  <pre><code>code\n::::\n</code></pre>\n</aside>\n<p>after <strong>b</strong></p>'

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
])('%s at the item content column closes the paragraph, so the fence ends at the closer', (_name, lines) => {
  expect(render(lines).trimEnd().endsWith(endsAtCloser)).toBe(true)
})

// A footnote's open paragraph takes the fence line and its payload lazily (carve#3885).
it('a footnote definition at the item content column takes the fence lines as note text', () => {
  expect(render(['- para', '  [^f]: n'])).toContain('</ul>\n  <div>\n\n  </div>\n</aside>\n<p>after <strong>b</strong></p>')
})

it.each([
  ['a definition below the column', ['- para', ' [r]: /u']],
  ['a definition below the column of an item with trailing spaces', ['- para  ', ' [r]: /u']],
  ['a table row below the column', ['10. para', '   | t |']],
  ['item prose after a table row', ['- para', '  | t |', '  more']],
])('control: %s leaves a paragraph open, so the fence is paragraph text', (_name, lines) => {
  expect(render(lines)).toContain('<p>after <strong>b</strong></p>\n    </div>')
})
