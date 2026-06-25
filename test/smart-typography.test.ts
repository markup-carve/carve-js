import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

describe('smart typography (grammar.ebnf §Smart Typography, PART 9 §8)', () => {
  it('converts dashes and ellipsis (longest match first)', () => {
    expect(h('a -- b --- c ...')).toBe('<p>a – b — c …</p>')
  })

  it('converts arrows and comparisons', () => {
    expect(h('-> <- <-> => != <= >= +-')).toBe(
      '<p>→ ← ↔ ⇒ ≠ ≤ ≥ ±</p>',
    )
  })

  it('converts symbols', () => {
    expect(h('(c) (r) (tm)')).toBe('<p>© ® ™</p>')
  })

  it('does not convert fractions (removed: they collide with dates/paths)', () => {
    expect(h('1/2 1/4 3/4 1/3 2/3 and a date 1/2/2024')).toBe(
      '<p>1/2 1/4 3/4 1/3 2/3 and a date 1/2/2024</p>',
    )
  })

  it('makes contextual double quotes', () => {
    expect(h('say "hello" now')).toBe('<p>say “hello” now</p>')
  })

  it('makes contextual single quotes and apostrophes', () => {
    expect(h("it's a 'tagged' word")).toBe('<p>it’s a ‘tagged’ word</p>')
  })

  it('respects backslash escapes', () => {
    expect(h('\\-> \\... \\-- \\"x\\"')).toBe('<p>-&gt; ... -- "x"</p>')
  })

  it('does not transform inside an inline code span', () => {
    expect(h('`a -- b ... "c"` and -- out')).toBe(
      '<p><code>a -- b ... "c"</code> and – out</p>',
    )
  })

  it('does not transform inside a fenced code block', () => {
    expect(h('```\na -- b ... "c"\n```')).toBe(
      '<pre><code>a -- b ... "c"\n</code></pre>',
    )
  })

  it('converts inside other inline constructs', () => {
    expect(h('*a -- b*')).toBe('<p><strong>a – b</strong></p>')
  })

  it('keeps correct quote direction across a preceding inline node', () => {
    // A space after the node is ordinary text, so the opening quote is
    // still opening...
    expect(h('*hi* "there"')).toBe('<p><strong>hi</strong> “there”</p>')
    expect(h('[x](u) "there"')).toBe('<p><a href="u">x</a> “there”</p>')
    expect(h('`c` "there"')).toBe('<p><code>c</code> “there”</p>')
    // ...and a quote that abuts the node with no space is a closing
    // quote, exactly like `word"x"`.
    expect(h('*hi*"x"')).toBe('<p><strong>hi</strong>”x”</p>')
  })

  it('handles a closing quote right after an opaque code span', () => {
    expect(h('"`x`"')).toBe('<p>“<code>x</code>”</p>')
  })

  it('treats a non-breaking space as whitespace for quote flanking', () => {
    // An escaped non-breaking space (`\ ` -> U+E000 placeholder) is
    // whitespace, so a following quote opens, exactly as after a real space.
    expect(h("say\\ 'twas")).toBe('<p>say&nbsp;‘twas</p>')
    expect(h('a\\ "x"')).toBe('<p>a&nbsp;“x”</p>')
    // A literal U+00A0 in the source behaves the same.
    expect(h("a 'tis")).toBe('<p>a&nbsp;‘tis</p>')
    expect(h('a "x"')).toBe('<p>a&nbsp;“x”</p>')
  })
})

describe('= opens a quote; empty link destination is literal', () => {
  const h2 = (x) => carveToHtml(x)
  it('opens a quote after = (attribute-like text)', () => {
    expect(h2('="x"')).toBe('<p>=“x”</p>')
    expect(h2('a="b"')).toBe('<p>a=“b”</p>')
  })
  it('keeps an empty-destination link literal but parses a real one', () => {
    expect(h2('[a]()')).toBe('<p>[a]()</p>')
    expect(h2('[a](u)')).toBe('<p><a href="u">a</a></p>')
    expect(h2('[a](u "t")')).toBe('<p><a href="u" title="t">a</a></p>')
  })
})
