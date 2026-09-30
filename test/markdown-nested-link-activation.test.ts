import { expect, test } from 'vitest'
import { markdownToCarve, carveToHtml } from '../src/index.js'

test.each([
  ['[foo [bar](/uri)](/uri)', '<p>[foo <a href="/uri">bar</a>](/uri)</p>'],
  ['[foo *[bar [baz](/uri)](/uri)*](/uri)', '<p>[foo <em>[bar <a href="/uri">baz</a>](/uri)</em>](/uri)</p>'],
  ['[foo [bar](/uri)][ref]\n\n[ref]: /uri', '<p>[foo <a href="/uri">bar</a>]<a href="/uri">ref</a></p>'],
  ['[foo *bar [baz][ref]*][ref]\n\n[ref]: /uri', '<p>[foo <em>bar <a href="/uri">baz</a></em>]<a href="/uri">ref</a></p>'],
  ['[[a](/u)](/v) *x*', '<p>[<a href="/u">a</a>](/v) <em>x</em></p>'],
  ['[[a](/u)](*v*)', '<p>[<a href="/u">a</a>](<em>v</em>)</p>'],
])('an active inner link deactivates its outer link: %s', (source, expected) => {
  expect(carveToHtml(markdownToCarve(source)).trim()).toBe(expected)
})

test('brackets inside an HTML tag preserve the active outer link', () => {
  const html = carveToHtml(markdownToCarve('[x <span title="[a](/u)">](/v)'))
  expect(html).toContain('<a href="/v">x <span title="[a](/u)">')
})

test('ordinary parenthesized quotes do not hide active inner links', () => {
  const html = carveToHtml(markdownToCarve('(say "x) [y [a](/u)](/v) "z"'))
  expect(html).toContain('<a href="/u">a</a>')
  expect(html).not.toContain('<a href="/v">')
})

test('an autolink body does not deactivate its outer link', () => {
  const html = carveToHtml(markdownToCarve('[x <http://a.b/[c](d)>](/v)'))
  expect(html).toContain('<a href="/v">x http://a.b/[c](d)</a>')
})

test('a failed title does not hide links in ordinary following text', () => {
  const html = carveToHtml(markdownToCarve('[x](a "b) text [y [a](/c)](/v) "q"'))
  expect(html).toContain('<a href="/c">a</a>')
  expect(html).not.toContain('<a href="/v">')
})

test('a malformed email autolink keeps its active inner link', () => {
  const html = carveToHtml(markdownToCarve('[x <a@[b](/u)>](/v)'))
  expect(html).toContain('<a href="/u">b</a>')
  expect(html).not.toContain('<a href="/v">')
})

test('an image alt retains the literal outer brackets of an inactive nested link', () => {
  expect(carveToHtml(markdownToCarve('![[[foo](uri1)](uri2)](uri3)')).trim()).toBe('<img src="uri3" alt="[foo](uri2)">')
})
