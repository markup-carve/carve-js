import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { markdownToCarve, markdownToCarveWithLosses } from '../src/markdown-migrate.js'
import { markdownEmphasis } from '../src/markdown-emphasis.js'
import { djotToCarve } from '../src/djot-import.js'

it.each([
  ['***foo**', '<p>*<strong>foo</strong></p>'],
  ['*(*word*)*', '<p><em>(<em>word</em>)</em></p>'],
  ['__one __two__ three__', '<p><strong>one <strong>two</strong> three</strong></p>'],
  ['alpha*beta*gamma', '<p>alpha<em>beta</em>gamma</p>'],
  ['***word** rest*', '<p><em><strong>word</strong> rest</em></p>'],
  ['**word *rest***', '<p><strong>word <em>rest</em></strong></p>'],
  ['alpha__beta__gamma', '<p>alpha__beta__gamma</p>'],
  ['пристаням__стремятся__', '<p>пристаням__стремятся__</p>'],
  ['#\tHeading', '<section id="Heading">\n  <h1>Heading</h1>\n</section>'],
])('preserves Markdown meaning: %s', (source, expected) => {
  expect(carveToHtml(markdownToCarve(source))).toBe(expected)
})

it('reports only the nested wrapper that cannot be represented', () => {
  // carve#2877 gave a same-kind wrapper a spelling, so only one past the
  // native nesting budget is still a loss.
  expect(markdownToCarveWithLosses('*(*word*)*').losses).toEqual([])
  expect(markdownToCarveWithLosses('*word*').losses).toEqual([])
  expect(markdownToCarveWithLosses('*'.repeat(600) + 'word' + '*'.repeat(600)).losses).toEqual([
    { code: 'structure-unspellable', message: expect.any(String) },
  ])
})

it('handles deep delimiter runs without recursive rendering', () => {
  // The run nests to the native budget and the rest flattens, so the guard is
  // the absence of recursion, not a one-level result.
  expect(markdownEmphasis('*'.repeat(20_000) + 'word' + '*'.repeat(20_000)))
    .toBe('{*'.repeat(199) + 'word' + '*}'.repeat(199))
  expect(markdownEmphasis('a_ '.repeat(10_000))).toBe('a_ '.repeat(10_000))
})

it.each([
  ['a *word{#id key="*"}*', '<p>a <strong><span id="id" key="*">word</span></strong></p>'],
  ['*more words{#id key="*"} here*', '<p><strong>more <span id="id" key="*">words</span> here</strong></p>'],
  ['`*word{#id key="*"}*`', '<p><code>*word{#id key="*"}*</code></p>'],
])('keeps Djot attribute values out of delimiter matching: %s', (source, expected) => {
  expect(carveToHtml(djotToCarve(source))).toBe(expected)
})

it.each([
  ['`code`__bold__', '<p><code>code</code><strong>bold</strong></p>'],
  ['__bold__`code`', '<p><strong>bold</strong><code>code</code></p>'],
  ['[a](http://x)__b__', '<p><a href="http://x">a</a><strong>b</strong></p>'],
])('reads protected span boundaries: %s', (source, expected) => {
  expect(carveToHtml(markdownToCarve(source))).toBe(expected)
})

it('visits inactive delimiter runs only once', () => {
  const n = 2_000
  let steps = 0
  const result = markdownEmphasis('*a '.repeat(n) + '_b '.repeat(n) + 'a* '.repeat(n), undefined, () => steps++)
  expect(result).toContain('a')
  expect(steps).toBeLessThan(20 * n)
})

it('preserves dollar replacement sequences in Djot attributes', () => {
  const output = djotToCarve('*word{key="a$&b"}*')
  expect(carveToHtml(output)).toBe('<p><strong><span key="a$&amp;b">word</span></strong></p>')
  expect(output).not.toContain('\x00')
})
