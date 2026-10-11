import { expect, test } from 'vitest'
import { djotToCarve, carveToHtml } from '../src/index.js'
import pending from './fixtures/djot-pending-attributes.json'

test.each([
  ['{#id} at beginning\n', '<p> at beginning</p>'],
  ['After {#id} space\n{.class}\n', '<p>After  space\n</p>'],
  ['not a [span] {#id}.\n', '<p>not a [span] .</p>'],
  ['{#id .class}\n\nA paragraph\n', '<p id="id" class="class">A paragraph</p>'],
  ['{.a}\n{.b}\n\npara', '<p class="a b">para</p>'],
  ['{.a}\n{.b}', ''],
  ['{.a}\n{.b}\n\n[r]: u\n\n[x][r]', '<p><a href="u" class="a b">x</a></p>'],
  ['{.a}\n{.b}\n[r]: u\n\n[x][r]', '<p><a href="u" class="a b">x</a></p>'],
  ['{.a}\n\n{.b}\n[r]: u\n\n[x][r]', '<p><a href="u" class="a b">x</a></p>'],
  ['[span]{#id}', '<p><span id="id">span</span></p>'],
  ['`x`{.c}', '<p><code class="c">x</code></p>'],
  ['<http://x.y>{.c}', '<p><a href="http://x.y" class="c">http://x.y</a></p>'],
])('Djot attribute ownership: %s', (source, expected) => {
  expect(carveToHtml(djotToCarve(source)).trim()).toBe(expected)
})

test.each(['```\nx\n```', '::: box\nx\n:::', '***', '| a |', '[r]: /u'])('keeps pending attributes after a closed block: %s', block => {
   expect(carveToHtml(djotToCarve(`${block}\n{.c}\npara`))).toContain('<p class="c">para</p>')
 })

test.each([
  [
    "> {.a}\n> {.b}\n>\n> para",
    "<blockquote><p class=\"a b\">para</p></blockquote>"
  ],
  [
    "> {.a}\n> {.b}\n\npara",
    "<blockquote></blockquote><p class=\"a b\">para</p>"
  ],
  [
    "{.a}\n> {.b}\n\n",
    "<blockquote class=\"a\"></blockquote>"
  ],
  [
    "{.a}\n> {.b}\n>\n> para",
    "<blockquote class=\"a\"><p class=\"b\">para</p></blockquote>"
  ],
  [
    "```\n{.a}\n{.b}\n\npara\n```",
    "<pre><code>{.a}\n{.b}\n\npara\n</code></pre>"
  ]
])('keeps the container of a pending attribute run: %s', (source, expected) => {
  expect(carveToHtml(djotToCarve(source)).trim().replace(/>\s+</g, '><')).toBe(expected)
})

const blockHtml = (html: string): string => html.replace(/<\/?tbody>/g, '').replace(/\s+/g, ' ').replace(/> | </g, value => value.trim()).trim()

test.each(pending)('preserves pending block attributes: $source', ({ source, html }) => {
  expect(blockHtml(carveToHtml(djotToCarve(source)))).toBe(blockHtml(html))
})

test('keeps a long pending value through chained quote exits', () => {
  const value = 'v'.repeat(32768)
  const classes = Array.from({ length: 63 }, (_, index) => `c${index}`)
  const source = '> '.repeat(64) + `{title="${value}"}\n` + classes.map((name, index) => '> '.repeat(63 - index) + `{.${name}}\n`).join('') + '\nword'
  const imported = djotToCarve(source)
  expect(imported.split(value)).toHaveLength(2)
  expect(imported.length).toBeLessThan(source.length * 2)
  expect(carveToHtml(imported)).toContain(`<p title="${value}" class="${classes.join(' ')}">word</p>`)
})
