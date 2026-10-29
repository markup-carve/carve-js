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
    ['a forced strong', 'Run {*`make*}[the docs](u).', '<p>Run {*<code>make*}[the docs](u).</code></p>'],
    ['a forced emphasis', 'x{/`a/}[n](u)', '<p>x{/<code>a/}[n](u)</code></p>'],
    ['a forced strike', 'x{~`a~}[n](u)', '<p>x{~<code>a~}[n](u)</code></p>'],
    ['an empty run in a forced strong', 'x{*``*}[n](u)', '<p>x{*<code>*}[n](u)</code></p>'],
    ['an image after it', 'x{*`a*}![n](u)', '<p>x{*<code>a*}![n](u)</code></p>'],
    ['a span after it', 'x{*`a*}[n]{.k}', '<p>x{*<code>a*}[n]{.k}</code></p>'],
    ['an insertion', '{+`a+} [n](u)', '<p>{+<code>a+} [n](u)</code></p>'],
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
