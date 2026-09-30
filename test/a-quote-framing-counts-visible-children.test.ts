import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).replace(/\n+$/, '')

/**
 * A block quote with ONE child that renders something is compact; with several
 * it is expanded. A comment (PART 9 §4.13) and a raw block for another target
 * both render '', and counting such a child pushed a single-paragraph quote
 * into the expanded form (markup-carve/carve#1106).
 *
 * The oracle produces the compact form for all three rows below. The same rule
 * already governs list items (carve-js#991); this brings the quote renderer to
 * it. "Renders nothing" is decided by rendering, not by a type list, because
 * two unrelated node types reach it.
 */
describe('a block quote framing counts only visible children', () => {
  it.each([
    ['a line comment first', '> %% c\n> y\n'],
    ['a line comment second', '> y\n> %% c\n'],
    ['a comment fence', '> %%%\n> c\n> %%%\n> y\n'],
    ['a raw block for another target', '> ```=latex\n> \\x\n> ```\n> y\n'],
  ])('%s leaves the quote compact', (_name, source) => {
    expect(html(source)).toBe('<blockquote><p>y</p></blockquote>')
  })

  /**
   * BOUNDS. None moves under the mutation that reverts the fix, so they pin
   * what it must not change rather than proving it.
   */
  describe('unchanged', () => {
    it('a plain quote is already compact', () => {
      expect(html('> x\n')).toBe('<blockquote><p>x</p></blockquote>')
    })

    it('two real paragraphs still expand', () => {
      expect(html('> a\n>\n> b\n')).toBe('<blockquote>\n  <p>a</p>\n  <p>b</p>\n</blockquote>')
    })

    it('a quote holding only a comment is unchanged', () => {
      expect(html('> %% c\n')).toBe('<blockquote>\n\n</blockquote>')
    })
  })

  // Counting text reads detects repeated rendering without depending on CI
  // scheduling. Rendering each child twice grows exponentially with depth.
  it('does not render a nested quote more than once per level', () => {
    const ast = parse('> '.repeat(12) + 'x\n')
    let block = ast.children[0]!
    while (block.type === 'block_quote') block = block.children[0]!
    if (block.type !== 'paragraph') throw new Error('Expected the quote paragraph')
    const text = block.children[0]!
    if (text.type !== 'text') throw new Error('Expected the paragraph text')
    const value = text.value
    let reads = 0
    Object.defineProperty(text, 'value', {
      enumerable: true,
      get() { reads++; return value },
    })
    const rendered = renderHtml(ast)
    expect(rendered).toContain('<p>x</p>')
    expect(rendered.match(/<blockquote>/g)).toHaveLength(12)
    expect(reads).toBeLessThan(10)
  })
})
