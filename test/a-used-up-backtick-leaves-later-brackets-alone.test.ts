import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml } from '../src/index.js'
import { expectScansLinearly } from './helpers/scaling.js'

// A link's text is scanned from its own `[` (CARVE-P3-001), so a backtick an
// earlier construct already used up cannot keep a later bracket from closing
// (carve-js#1815, markup-carve/carve#2074).

// Both routes: the parse-and-render pipeline and `carveToHtml`, which may take a fast path.
const html = (source: string) => {
  const parsed = renderHtml(parse(source)).trim()
  expect(carveToHtml(source).trim()).toBe(parsed)
  return parsed
}

describe('a bracket after a backtick an earlier construct used up', () => {
  it.each([
    ['a forced strong', 'Run {*`make*}[the docs](u).', '<p>Run <strong><code>make</code></strong><a href="u">the docs</a>.</p>'],
    ['a forced emphasis', 'x{/`a/}[n](u)', '<p>x<em><code>a</code></em><a href="u">n</a></p>'],
    ['a forced strike', 'x{~`a~}[n](u)', '<p>x<s><code>a</code></s><a href="u">n</a></p>'],
    ['an empty run in a forced strong', 'x{*``*}[n](u)', '<p>x<strong><code></code></strong><a href="u">n</a></p>'],
    ['an image after it', 'x{*`a*}![n](u)', '<p>x<strong><code>a</code></strong><img src="u" alt="n"></p>'],
    ['a span after it', 'x{*`a*}[n]{.k}', '<p>x<strong><code>a</code></strong><span class="k">n</span></p>'],
    ['an insertion', '{+`a+} [n](u)', '<p><ins><code>a</code></ins> <a href="u">n</a></p>'],
    ['an attribute value', '[a]{title="`"} [n](u)', '<p><span title="`">a</span> <a href="u">n</a></p>'],
    ['a code span attribute value', '`a`{title="`"} [n](u)', '<p><code title="`">a</code> <a href="u">n</a></p>'],
    ['a destination, with a later pair of runs', '[m](u`) and [m](`v) and [n](w)', '<p><a href="u`">m</a> and <a href="`v">m</a> and <a href="w">n</a></p>'],
    ['a destination in a document holding a comment', '{% a %}x\n\n[m](u`) and [n](v)', '<p>x</p>\n<p><a href="u`">m</a> and <a href="v">n</a></p>'],
  ])('is a link or span after %s', (_, source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it.each([
    ['an unclosed run before the only closer', '[a `b](u)', '<p>[a <code>b](u)</code></p>'],
    ['an escaped closer after a used-up run', '[m](u`) and [\\]m](`v)', '<p><a href="u`">m</a> and <a href="`v">]m</a></p>'],
    ['an unclosed run after a used-up run', '[m](u`) and [m ``b](`v)', '<p><a href="u`">m</a> and [m <code>b](`v)</code></p>'],
    ['an editorial comment holding the closer', '[{#a]b#}](u)', '<p><a href="u"><span class="critic-comment">a]b</span></a></p>'],
  ])('still reads %s', (_, source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it('scans a run of used-up backticks before unclosed brackets linearly', () => {
    expectScansLinearly((input) => void carveToHtml(input), '{*`*}[', { label: 'used-up backtick before an open bracket' })
  })
})
