import { describe, it, expect } from 'vitest'
import {
  parse,
  carveToHtml,
  carveToCarve,
  renderHtml,
  renderCarve,
  renderMarkdown,
  renderPlainText,
  renderAnsi,
  type BlockNode,
  type Document,
} from '../src/index.js'
import { MAX_RENDER_DEPTH, RenderDepthError } from '../src/render-depth.js'

// Regression guard: deeply nested block containers must not overflow the call
// stack. Each `>` level recurses parseBlocks -> parseBlock -> parseBlockQuote,
// so thousands of levels used to throw "Maximum call stack size exceeded".
// MAX_NESTING_DEPTH caps the recursion and degrades to literal text past it.

describe('deep nesting does not overflow the stack', () => {
  it('parses thousands of nested blockquotes without throwing', () => {
    for (const depth of [2000, 5000, 20000]) {
      const src = '> '.repeat(depth) + 'x'
      expect(() => parse(src)).not.toThrow()
    }
  })

  it('parses deeply nested divs without throwing', () => {
    const src = ':::\n'.repeat(5000) + 'x\n' + ':::\n'.repeat(5000)
    expect(() => parse(src)).not.toThrow()
  })

  it('still nests modest blockquote depth correctly', () => {
    expect(carveToHtml('> > a')).toBe(
      '<blockquote>\n  <blockquote><p>a</p></blockquote>\n</blockquote>',
    )

    let node = parse('> > > x').children[0]
    let depth = 0
    while (node && node.type === 'block_quote') {
      depth++
      node = node.children?.[0]
    }
    expect(depth).toBe(3)
  })
})

/*
 * §25 (carve#547, closing carve#494): a flattened over-cap opener is ORDINARY
 * PARAGRAPH TEXT, so it groups by the ordinary paragraph rule - consecutive
 * over-cap openers and any text following them form ONE paragraph, ending at
 * the first blank line.
 *
 * carve-js used to emit one paragraph per opener except the last, which
 * grouped with the following text. That was an artifact of where the degrade
 * path handed back to the block parser, not a rule; three engines gave three
 * answers and all three satisfied "becomes literal paragraph text".
 */
describe('over-cap openers group as one paragraph', () => {
  const MAX_NESTING_DEPTH = 200

  it('groups the flattened tail with the text after it', () => {
    const over = 3
    const html = carveToHtml(
      Array(MAX_NESTING_DEPTH + over).fill('::: note').join('\n') + '\nx\n',
    )
    expect(html.match(/<aside/g)?.length).toBe(MAX_NESTING_DEPTH)
    expect(html.match(/<p>/g)?.length).toBe(1)
    expect(html).toContain('<p>::: note\n::: note\n::: note\nx</p>')
  })

  it('ends the paragraph at the first blank line', () => {
    const html = carveToHtml(
      Array(MAX_NESTING_DEPTH + 2).fill('::: note').join('\n') + '\n\nx\n',
    )
    expect(html).toContain('<p>::: note\n::: note</p>')
  })

  it('flattens a quote run the same way', () => {
    const html = carveToHtml('> '.repeat(MAX_NESTING_DEPTH + 2) + 'x\n')
    expect(html.match(/<blockquote>/g)?.length).toBe(MAX_NESTING_DEPTH)
    expect(html.match(/<p>/g)?.length).toBe(1)
  })
})

describe('the canonical writer survives deep container nesting', () => {
  it('keeps 40 nested containers nested across a fmt pass', () => {
    // Equal-length fences do not nest, so real depth needs a widening fence per
    // level: the writer has to reproduce that ladder, not a fixed `::::`.
    const depth = 40
    const width = (level: number) => ':'.repeat(depth + 2 - level)
    let src = ''
    for (let level = 0; level < depth; level++) src += width(level) + '\n'
    src += 'x\n'
    for (let level = depth - 1; level >= 0; level--) src += width(level) + '\n'

    const containerDepth = (source: string) => {
      let node = parse(source).children[0]
      let seen = 0
      while (node && (node.type === 'div' || node.type === 'admonition')) {
        seen++
        node = node.children?.[0]
      }
      return seen
    }
    expect(containerDepth(src)).toBe(depth)

    const formatted = carveToCarve(src)
    expect(containerDepth(formatted)).toBe(depth)
    expect(carveToHtml(formatted)).toBe(carveToHtml(src))
    expect(carveToCarve(formatted)).toBe(formatted)
  })
})

/*
 * §25 (carve#548, closing carve#526): AT THE RENDER CEILING, A RENDERER
 * REFUSES - with a typed failure naming the depth bound, not silent
 * truncation, not a partial document, and not whatever the host raises when
 * the stack runs out.
 *
 * `renderHtml` is the one that had no ceiling at all: it recursed until the
 * host stack gave out, which made the reference engine's primary renderer the
 * one that behaved unlike every renderer in the ecosystem, its own siblings
 * included.
 */
describe('every renderer refuses at the render ceiling', () => {
  const quotes = (depth: number): Document => {
    let node: BlockNode = { type: 'paragraph', children: [{ type: 'text', value: 'x' }] }
    for (let i = 0; i < depth; i++) node = { type: 'block_quote', children: [node] }
    return { type: 'document', children: [node] }
  }
  const renderers: [string, (doc: Document) => string][] = [
    ['renderHtml', renderHtml],
    ['renderMarkdown', renderMarkdown],
    ['renderCarve', renderCarve],
    ['renderPlainText', renderPlainText],
    ['renderAnsi', renderAnsi],
  ]

  it.each(renderers)('%s keeps the content one level under the ceiling', (_name, render) => {
    expect(render(quotes(MAX_RENDER_DEPTH - 1))).toContain('x')
  })

  it.each(renderers)('%s refuses at the ceiling', (_name, render) => {
    expect(() => render(quotes(MAX_RENDER_DEPTH))).toThrow(RenderDepthError)
  })

  it.each(renderers)('%s refuses far past it rather than overflowing', (_name, render) => {
    // The depth `renderHtml` used to die on with a RangeError, and an order of
    // magnitude past it.
    expect(() => render(quotes(2000))).toThrow(RenderDepthError)
    expect(() => render(quotes(50_000))).toThrow(RenderDepthError)
  })

  it('counts a nested renderHtml() from an extension against the same ceiling', () => {
    // Depth is a property of the HOST STACK, not of the document, so a nested
    // render adds to the count rather than restarting it. Restarting would hand
    // an extension a way to defeat the ceiling: re-enter `renderHtml()` at each
    // level and the counter never reaches the cap while the real stack does.
    const inner = quotes(MAX_RENDER_DEPTH - 20)
    // On its own the sub-document renders.
    expect(renderHtml(inner)).toContain('x')

    const nesting = {
      name: 'nest',
      blockRenderers: {
        div: () => renderHtml(inner),
      },
    }
    // Reached from 40 levels down, the same sub-document runs the count past
    // the cap and the render refuses.
    let node: BlockNode = { type: 'div', children: [] }
    for (let i = 0; i < 40; i++) node = { type: 'block_quote', children: [node] }
    expect(() =>
      renderHtml({ type: 'document', children: [node] }, { extensions: [nesting] as never }),
    ).toThrow(RenderDepthError)
  })

  it('names the bound in the message', () => {
    expect(() => renderHtml(quotes(2000))).toThrow(
      new RegExp(`render cap of ${MAX_RENDER_DEPTH}`),
    )
  })
})

describe('the canonical writer respects the render depth cap', () => {
  // An AST built through the API can nest far past the depth the parser allows.
  // Built directly rather than through `fromAstJson`, which refuses a payload
  // this deep on purpose (PART 12 §9): the property under test belongs to the
  // WRITER, and routing it through ingest would only test the ingest cap.
  const divs = (depth: number): Document => {
    let node: BlockNode = { type: 'div', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'x' }] }] }
    for (let i = 0; i < depth; i++) node = { type: 'div', children: [node] }
    return { type: 'doc', children: [node], footnoteDefs: {} }
  }

  it('refuses a tree past MAX_RENDER_DEPTH instead of writing a truncated one', () => {
    // §25: AT THE RENDER CEILING, A RENDERER REFUSES. The writer used to emit
    // the nested fences and delete the body, which is a document that looks
    // complete and is not - the one failure mode a formatter must never have
    // (carve#526).
    const started = Date.now()
    expect(() => renderCarve(divs(1000))).toThrow(RenderDepthError)
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('sizes fences from the containers it actually writes, below the cap', () => {
    // Derived, not pinned: the outermost fence is `:::` and each level inward
    // adds a colon, so the widest a bounded writer can emit is fixed by the cap
    // itself. Writing the number out instead made this test track the old cap
    // rather than the rule (issue 517).
    const formatted = renderCarve(divs(MAX_RENDER_DEPTH - 4))
    const widest = Math.max(...formatted.split('\n').map((line) => (/^:+$/.test(line) ? line.length : 0)))
    expect(widest).toBeLessThanOrEqual(3 + MAX_RENDER_DEPTH - 1)
    expect(formatted).toContain('x')
  })
})
