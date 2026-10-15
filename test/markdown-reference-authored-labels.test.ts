import { expect, it } from 'vitest'
import { parseFragment, serialize } from 'parse5'
import fixtures from './fixtures/markdown-reference-authored-labels.json'
import { carveToHtml, markdownToCarve, parse, renderHtml } from '../src/index.js'

it('keeps the shortcut with an unescaped label unresolved', () => {
  expect(carveToHtml(markdownToCarve('[a_~b]\n\n[a\\_~b]: /u\n'))).toBe('<p>[a_~b]</p>')
})

const normalized = (html: string): string => serialize(parseFragment(html.replace(/>\s+</g, '><').trim()))

// cmark-gfm 0.29.0.gfm.13 at 27d942c8, with strikethrough enabled.
it.each(fixtures)('matches authored reference labels: $source', row => {
  expect(normalized(carveToHtml(markdownToCarve(row.source)))).toBe(normalized(row.html))
})

it('keeps escape-distinct definitions and applies first wins to each source key', () => {
  const source = '[a_~b] [a\\_~b]\n\n[a_~b]: /plain\n[a\\_~b]: /escaped\n[a_~b]: /later\n'
  const html = carveToHtml(markdownToCarve(source))
  expect(html).toBe('<p><a href="/plain">a_~b</a> <a href="/escaped">a_~b</a></p>')
})

it('retains whitespace and case folding of source labels', () => {
  expect(carveToHtml(markdownToCarve('[A\\_ B]\n\n[a\\_  b]: /u\n'))).toBe('<p><a href="/u">A_ B</a></p>')
})

it.each([
  ['[a_~b]\n\n[a\\_~b]: <>', '<p>[a_~b]</p>'],
  ['[a\\_~b]\n\n[a\\_~b]: <>', '<p><a href="">a_~b</a></p>'],
  ['[a&b]\n\n[a&amp;b]: <>', '<p>[a&amp;b]</p>'],
  ['[a&amp;b]\n\n[a&amp;b]: <>', '<p><a href="">a&amp;b</a></p>'],
])('compares source labels when resolving an empty definition: %s', (source, expected) => {
  expect(carveToHtml(markdownToCarve(source))).toBe(expected)
})

it('keeps an empty image reference resolved after lone-image promotion', () => {
  const document = parse(markdownToCarve('> ![a][x]\n\n[x]: <>\n'))
  const expected = '<blockquote>\n  <img src="" alt="a">\n</blockquote>'
  expect(renderHtml(document)).toBe(expected)
  expect(renderHtml(JSON.parse(JSON.stringify(document)))).toBe(expected)
})

it('keeps an unresolved image in its paragraph after its definition is removed', () => {
  const document = parse(markdownToCarve('![a][r]\n\n[r]: <>\n'))
  expect(renderHtml(document)).toBe('<img src="" alt="a">')
  document.children = document.children.filter(node => node.type !== 'link_reference_definition')
  expect(renderHtml(document)).toBe('<p>![a][r]</p>')
})

it('clears a resolved empty reference after its definition is removed', () => {
  const document = parse(markdownToCarve('[x][r]\n\n[r]: <>\n'))
  expect(renderHtml(document)).toBe('<p><a href="">x</a></p>')
  document.children = document.children.filter(node => node.type !== 'link_reference_definition')
  expect(renderHtml(document)).toBe('<p>[x][r]</p>')
})
