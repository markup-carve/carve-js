import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A container's unconsumed `[label]` publishes its INLINE RUN, not the characters
 * the author typed. `CARVE-P9-041` enumerates a div label among the hosts that
 * have an inline run, which is what settles it (ruled on markup-carve/carve#2572,
 * ported for markup-carve/carve-js#2348). The engine's old position was not
 * tenable on its own terms either: a trailing `%%` comment inside a label was
 * already read as a run, so one host was answering two ways.
 *
 * Every expectation is the executable spec's, measured at markup-carve/carve
 * `89157529` in a clean worktree reproducing its corpus 2100/2100. No corpus row
 * pins a label carrying markup, which is why the corpus gate was silent on this.
 */

const label = (html: string): string =>
  (/<p class="div-label">([\s\S]*?)<\/p>/.exec(html) ?? ['', '(no label)'])[1]!

const forms: Array<[string, (inner: string) => string]> = [
  ['a bare div', (inner) => `:::[${inner}]\nbody\n:::\n`],
  ['a typed admonition', (inner) => `::: note [${inner}]\nbody\n:::\n`],
  ['a figure', (inner) => `::: figure [${inner}]\nbody\n:::\n`],
]

describe('a container label renders its inline run', () => {
  const rows: Array<[string, string]> = [
    ['a /b/', 'a <em>b</em>'],
    ['a *b*', 'a <strong>b</strong>'],
    ['a `c` b', 'a <code>c</code> b'],
    ['a \\* b', 'a * b'],
    ['a [x](/u) b', 'a <a href="/u">x</a> b'],
    ['a _b_', 'a <u>b</u>'],
    ['a ~x~ b', 'a <s>x</s> b'],
    ['a =x= b', 'a <mark>x</mark> b'],
    ['a [x]{.k} b', 'a <span class="k">x</span> b'],
  ]
  for (const [name, make] of forms) {
    it.each(rows)(`${name}: %s`, (inner, expected) => {
      expect(label(carveToHtml(make(inner)))).toBe(expected)
    })
  }
})

describe('the escaping the run already agreed on', () => {
  // These were never the divergence: the inline path escapes text exactly as the
  // escaping path did, so they are the control that says the fix moved the PARSE
  // and not the escaping.
  it.each([
    ['a <b> b', 'a &lt;b&gt; b'],
    ['a & b', 'a &amp; b'],
    ['a &amp; b', 'a &amp;amp; b'],
  ])('%s', (inner, expected) => {
    expect(label(carveToHtml(`:::[${inner}]\nbody\n:::\n`))).toBe(expected)
  })
})

describe('what the run leaves alone', () => {
  it.each([
    ['a $x$ b', 'a $x$ b'],
    ['a ^{x} b', 'a ^{x} b'],
    ['a :smile: b', 'a :smile: b'],
    ['a [b] c', 'a [b] c'],
    ['a [x][r] b', 'a [x][r] b'],
  ])('%s', (inner, expected) => {
    expect(label(carveToHtml(`:::[${inner}]\nbody\n:::\n`))).toBe(expected)
  })

  it('keeps an empty label apart from no label at all', () => {
    expect(label(carveToHtml(':::[]\nbody\n:::\n'))).toBe('')
    expect(label(carveToHtml(':::\nbody\n:::\n'))).toBe('(no label)')
  })

  it('still strips a trailing comment marker, which was already a run', () => {
    expect(label(carveToHtml(':::[a b %% c]\nbody\n:::\n'))).toBe('a b')
  })
})

describe('the fence info line keeps its own answer', () => {
  // Core does not render a fence's label at all, so nothing moves there. Stated
  // because the ticket's table covers the fence spelling too.
  it('renders no label element for a fence', () => {
    expect(carveToHtml('``` js [a /b/]\nx\n```\n')).not.toContain('div-label')
  })
})
