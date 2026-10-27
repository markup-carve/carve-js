import { expect, it } from 'vitest'
import { parseFragment, serialize } from 'parse5'
import { carveToHtml, markdownToCarve } from '../src/index.js'

const normalized = (html: string) => serialize(parseFragment(html.replace(/>\s+</g, '><').trim()))

it.each([
  ['> -\n> - a', '<blockquote>\n<ul>\n<li></li>\n<li>a</li>\n</ul>\n</blockquote>'],
  ['> - a\n> -', '<blockquote>\n<ul>\n<li>a</li>\n<li></li>\n</ul>\n</blockquote>'],
  ['> 1.\n> 2. a', '<blockquote>\n<ol>\n<li></li>\n<li>a</li>\n</ol>\n</blockquote>'],
])('preserves a quoted empty Markdown item: %s', (source, expected) => {
  expect(normalized(carveToHtml(markdownToCarve(source)))).toBe(normalized(expected))
})

it('keeps a quoted setext underline', () => {
  expect(carveToHtml(markdownToCarve('> text\n> -'))).toContain('<h2 id="text">text</h2>')
})

it('keeps a marker in quoted fenced code literal', () => {
  expect(carveToHtml(markdownToCarve('> ```\n> -\n> ```'))).toContain('<code>-\n</code>')
})

it('does not consume a literal private-use character beside an empty item', () => {
  const imported = markdownToCarve('> - \uE0FD\n> -')
  expect(imported).toContain('\uE0FD')
  expect(normalized(carveToHtml(imported))).toContain('\uE0FD')
})
