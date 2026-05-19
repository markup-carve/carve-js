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

  it('converts symbols and standalone fractions', () => {
    expect(h('(c) (r) (tm) 1/2 1/4 3/4 1/3 2/3')).toBe(
      '<p>© ® ™ ½ ¼ ¾ ⅓ ⅔</p>',
    )
  })

  it('does not convert a fraction glued to other digits', () => {
    expect(h('21/2 and 1/24')).toBe('<p>21/2 and 1/24</p>')
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
})
