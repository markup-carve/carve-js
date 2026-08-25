import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml, carveToMarkdown, carveToPlainText, parse } from '../src/index.js'
import { SMART_PUNCTUATION_GLYPHS } from '../src/ast.js'

/**
 * Smart typography carries its source run, so the Carve renderer reproduces
 * what the author wrote while every other target renders the glyph.
 */
const SOURCE_RUNS = [
  'a...b',
  'a---b',
  'a--b',
  'a----b',
  'a -> b',
  'a <- b',
  'a <-> b',
  'a => b',
  'a != b',
  'a <= b',
  'a >= b',
  'a +- b',
  '(c) 2026',
  'Brand (r)',
  'Brand (tm)',
  'say "hi"',
  "say 'hi'",
  "it's",
]

describe('smart punctuation nodes', () => {
  it.each(SOURCE_RUNS)('reproduces the source run for %j', (src) => {
    expect(carveToCarve(src).trim()).toBe(src)
  })

  it.each(SOURCE_RUNS)('formats idempotently and preserves rendered HTML for %j', (src) => {
    const formatted = carveToCarve(src)
    expect(carveToCarve(formatted).trim()).toBe(formatted.trim())
    expect(carveToHtml(formatted)).toBe(carveToHtml(src))
  })

  it('resolves the glyph in every presentation renderer', () => {
    const src = 'a...b -> c (c)'
    expect(carveToHtml(src).trim()).toBe('<p>a…b → c ©</p>')
    expect(carveToMarkdown(src).trim()).toBe('a…b → c ©')
    expect(carveToPlainText(src).trim()).toBe('a…b → c ©')
  })

  it.each(['--', '---', '...', '-->', '<==', '+-', '(c)'])(
    'keeps an attribute block literal after %j',
    (run) => {
      const source = `a${run}{x}`
      expect(carveToHtml(source).trim()).toContain('{x}</p>')
      expect(carveToCarve(source).trim()).toBe(source)
    },
  )

  it('carries the source run and the kind on the node', () => {
    const doc = parse('a...b')
    const kids = (doc.children[0] as { children: Array<Record<string, unknown>> }).children
    const node = kids[1]!
    expect(node.type).toBe('smart_punctuation')
    expect(node.kind).toBe('ellipsis')
    expect(node.value).toBe('...')
    expect(SMART_PUNCTUATION_GLYPHS['ellipsis']).toBe('…')
  })

  it('partitions a dash run into one node per resolved glyph', () => {
    // Four hyphens resolve to two en dashes, so the run becomes two nodes of
    // two hyphens each, together reproducing the original run.
    const doc = parse('word----word')
    const kids = (doc.children[0] as { children: Array<Record<string, unknown>> }).children
    expect(kids[1]!.kind).toBe('en_dash')
    expect(kids[1]!.value).toBe('--')
    expect(kids[2]!.kind).toBe('en_dash')
    expect(kids[2]!.value).toBe('--')
  })

  it('records the resolved glyph on a quote node', () => {
    const doc = parse('"hi"')
    const kids = (doc.children[0] as { children: Array<Record<string, unknown>> }).children
    expect(kids[0]!.kind).toBe('left_double_quote')
    expect(kids[0]!.glyph).toBe('“')
    expect(kids[0]!.value).toBe('"')
    expect(kids[2]!.kind).toBe('right_double_quote')
    expect(kids[2]!.glyph).toBe('”')
  })

  it('keeps quote flanking correct after a smart node flushes the buffer', () => {
    // An opening curly quote puts the NEXT quote in opening context, so the
    // decision has to see through the node that flushed the text buffer.
    expect(carveToHtml('""').trim()).toBe('<p>““</p>')
    expect(carveToHtml('*"start* end"').trim()).toBe('<p><strong>“start</strong> end”</p>')
  })

  it('flanks an escaped character as the character it is', () => {
    // `\{` is an opening bracket so the quote opens; `\<` and `\*` are not.
    expect(carveToHtml('\\{"quoted"\\}').trim()).toBe('<p>{“quoted”}</p>')
    expect(carveToHtml('\\<"q"\\>').trim()).toBe('<p>&lt;”q”&gt;</p>')
    expect(carveToHtml("\\*'q'\\*").trim()).toBe('<p>*’q’*</p>')
  })

  it('leaves escaped forms literal in both directions', () => {
    expect(carveToHtml('a\\.\\.\\.b').trim()).toBe('<p>a...b</p>')
    expect(carveToCarve('a\\.\\.\\.b').trim()).toBe('a\\.\\.\\.b')
  })

  it('never touches a code span', () => {
    expect(carveToHtml('`a...b -> c`').trim()).toBe('<p><code>a...b -&gt; c</code></p>')
  })
})
