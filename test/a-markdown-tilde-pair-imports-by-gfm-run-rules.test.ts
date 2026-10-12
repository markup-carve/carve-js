import { expect, it } from 'vitest'
import { markdownToCarve, parse, renderHtml } from '../src/index.js'

const cases = [
  ["~a~~", "<p>~a~~</p>"],
  ["~a~b~", "<p><del>a</del>b~</p>"],
  ["~~a~", "<p>~~a~</p>"],
  ["~~a~~b~~", "<p><del>a</del>b~~</p>"],
  ["~a~", "<p><del>a</del></p>"],
  ["~~a~~", "<p><del>a</del></p>"],
  ["x~a~y", "<p>x<del>a</del>y</p>"],
  ["~a~b", "<p><del>a</del>b</p>"],
  ["a~b~c~d", "<p>a<del>b</del>c~d</p>"],
  ["~a~ ~b~", "<p><del>a</del> <del>b</del></p>"],
  ["~~a~b~~", "<p><del>a~b</del></p>"],
  ["~a~~b~", "<p><del>a~~b</del></p>"],
  ["~a ~b~", "<p>~a <del>b</del></p>"],
  ["~a~~~", "<p>~a~~~</p>"],
  ["~a~b~c~", "<p><del>a</del>b<del>c</del></p>"],
  ["a ~b~c", "<p>a <del>b</del>c</p>"],
  ["~ a~", "<p>~ a~</p>"],
  ["~a ~", "<p>~a ~</p>"],
  ["*~a~b~*", "<p><em><del>a</del>b~</em></p>"],
  ["~~a~~b", "<p><del>a</del>b</p>"],
  ["~a~.", "<p><del>a</del>.</p>"],
  ["*~a~*", "<p><em><del>a</del></em></p>"],
  ["**~~a~~**", "<p><strong><del>a</del></strong></p>"],
  ["~*a*~", "<p><del><em>a</em></del></p>"],
  ["~~**a**~~", "<p><del><strong>a</strong></del></p>"],
  ["~~*a~ b*~~", "<p><del><em>a~ b</em></del></p>"],
  ["\\~a\\~", "<p>~a~</p>"],
  ["~a\\~b~", "<p><del>a~b</del></p>"],
]

it.each(cases)('imports GFM tilde runs: %s', (source, expected) => {
  const html = renderHtml(parse(markdownToCarve(source + '\n'))).trim()
  expect(html.replace(/<s>/g, '<del>').replace(/<\/s>/g, '</del>')).toBe(expected)
})

it.each([
  ['`~a~~`', '<p><code>~a~~</code></p>'],
  ['~~~\n~a~~\n~~~', '<pre><code>~a~~\n</code></pre>'],
  ['[a](/~a~~)', '<p><a href="/~a~~">a</a></p>'],
  ['<https://example.com/~a~~>', '<p><a href="https://example.com/~a~~">https://example.com/~a~~</a></p>'],
])('keeps protected tildes: %s', (source, expected) => {
  expect(renderHtml(parse(markdownToCarve(source + '\n'))).trim()).toBe(expected)
})
