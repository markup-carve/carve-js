import { expect, it } from 'vitest'
import { parse, renderHTML } from '@djot/djot'
import { carveToHtml, djotToCarve } from '../src/index.js'

it.each([
  '{% x\ny %}\n',
  '# a\n{% x\ny %}\n# b\n',
  '> {% x\n> y %}\n',
  '- {% x\n  y %}\n',
])('keeps visible text in an invalid block comment: %j', source => {
  const html = carveToHtml(djotToCarve(source))
  expect(html).toContain('x')
  expect(html).toContain('y')
  expect(html).not.toContain('<h1>b</h1>')
  if (source.startsWith('#')) expect(html).toContain('<h1>a</h1>')
  expect(renderHTML(parse(source))).toContain('x')
})

it.each(['{% x %}\n', '{% x\n  y %}\n', 'a {% x\ny %} z\n'])('still consumes a valid comment: %j', source => {
  expect(carveToHtml(djotToCarve(source)).trim()).toBe(renderHTML(parse(source)).trim())
})

it('keeps the rejected run and following heading marker in the same paragraph', () => {
  expect(djotToCarve('# a\n{% x\ny %}\n# b\n')).toBe('# a\n\n\\{% x\ny %}\n\\# b\n')
})

it.each(['- a\n{% 50% off %}\n', '# a\n{% 50% off %}\n', '- a\n {% x\n y %}\n', 'para\n# not a heading\n{% x\ny %}\n', 'para\n- not an item\n{% x\ny %}\n', 'p\n\na\n{% x\ny %} z\n', '- a\n\n  b\n  {% x\n  y %} z\n', '> p\n>\n> a\n> {% x\n> y %} z\n', 'Hi. there\n{% x\ny %} z\n', 'Iv. lead\n{% x\ny %} z\n', 'a\n{% x\ny %} z\n', '- a\n  {% x\n  y %} z\n', '# a\n{x y}\n'])('retains paragraph continuation and same-line brace failures: %j', source => {
  expect(carveToHtml(djotToCarve(source)).replace(/>\s+</g, '><').replace(/\s+/g, ' ').replace(/ </g, '<').replace(/> /g, '>').trim()).toBe(renderHTML(parse(source)).replace(/>\s+</g, '><').replace(/\s+/g, ' ').replace(/ </g, '<').replace(/> /g, '>').trim())
})

it('ends a list before an unindented rejected comment', () => {
  const html = carveToHtml(djotToCarve('- a\n{% x\ny %}\n'))
  expect(html).toContain('<li>a</li>')
  expect(html).toContain('<p>{% x\ny %}</p>')
})

it.each(['- a\n\n  b\n{% x\ny %}\n', '> a\nb\n{% x\ny %}\n', '{.c}\n{% x\ny %}\n'])('retains a block comment outside its former container: %j', source => {
  const html = carveToHtml(djotToCarve(source))
  expect(html).toContain('{% x')
  expect(html).toContain('y %}')
})

it('consumes an inline multiline comment in a footnote body', () => {
  const html = carveToHtml(djotToCarve('a[^n]\n\n[^n]: text\n  {% x\n  y %} z\n'))
  expect(html).not.toContain('{% x')
  expect(html).toContain('text')
  expect(html).toContain('z')
})

it('consumes consecutive multiline block comments without recursive context probes', () => {
  expect(carveToHtml(djotToCarve('{% x\n  y %}\n'.repeat(64))).trim()).toBe('')
})

it('consumes a multiline comment in definition-list text', () => {
  const html = carveToHtml(djotToCarve(': def\n  {% x\n  y %} z\n'))
  expect(html.replace(/\s+/g, ' ')).toContain('<dt>def z</dt>')
  expect(html).not.toContain('{% x')
})

import boundaries from './fixtures/djot-comment-boundary-fixtures.json'
const normalizeHtml = (html: string): string => html.replace(/>\s+</g, '><').replace(/\s+/g, ' ').replace(/ </g, '<').replace(/> /g, '>').trim()
it.each(boundaries)('matches shared reference fixture $id', ({source, html}) => {
  expect(normalizeHtml(carveToHtml(djotToCarve(source)))).toBe(normalizeHtml(html))
})
it('does not reuse paragraph context past blank lines or a new source', () => {
  for (const source of ['a\n{% x\ny %}\n\n{% x\ny %}\n', '> a\n> {% x\n> y %}\n\n{% x\ny %}\n', '# a\n{% x\ny %}\n']) {
    expect(normalizeHtml(carveToHtml(djotToCarve(source)))).toBe(normalizeHtml(renderHTML(parse(source))))
  }
})

it.each([
  '> > inner\n> {% c %\n> tail\n',
  'para {% open\n\n# Title {#keep}\n',
  'Done. > {% c %\n> next\n',
])('preserves boundaries after a rejected comment: %j', source => {
  const normalize = (html: string): string => html.replace(/<section[^>]*>|<\/section>/g, '').replace(/ id="[^"]*"/g, '').replace(/>\s+</g, '><').replace(/\s+/g, ' ').replace(/ </g, '<').replace(/> /g, '>').trim()
  expect(normalize(carveToHtml(djotToCarve(source)))).toBe(normalize(renderHTML(parse(source))))
})

it.each([
  ['> text {% open\n>\n> next {#id}\n', '> text \\{% open\n>\n> next \n'],
  ['Iv. > {% c %\n> next\n', 'Iv. > \\{% c %\n\\> next\n'],
  ['did. > {% c %\n> next\n', 'did. > \\{% c %\n> next\n'],
])('keeps quoted paragraph and list boundaries: %j', (source, expected) => {
  expect(djotToCarve(source)).toBe(expected)
})

it.each(['> para {% a\n> %}\n', '{% a\r\n\r\nb %}\n'])('keeps closing lines and CRLF paragraph boundaries: %j', source => {
  const html = carveToHtml(djotToCarve(source))
  if (source.startsWith('>')) expect(html).not.toContain('{%')
  else { expect(html).toContain('a'); expect(html).toContain('b') }
})

it('keeps a one-space list continuation after a rejected quoted comment', () => {
  expect(djotToCarve('- > {% a\n > b %}\n')).toBe('- > \\{% a\n  > \\> b %}\n')
})

it('preserves quote ownership when rejected comments are indented', () => {
  const source = '> - {% a\n> b %}\n'
  const expected = djotToCarve(source)
  for (const width of [1, 2, 4, 8]) {
    const indented = source.split('\n').map(line => line ? ' '.repeat(width) + line : line).join('\n')
    expect(djotToCarve(indented)).toBe(expected)
  }
})
