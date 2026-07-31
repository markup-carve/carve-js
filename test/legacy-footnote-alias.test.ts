import { describe, expect, it } from 'vitest'
import { renderHtml, renderMarkdown, renderCarve, renderAnsi } from '../src/index.js'
import type { Document } from '../src/ast.js'

/**
 * A serialized AST outlives the version that produced it. carve-js 0.1.2
 * published `footnote` for both `[^a]` and `^[…]`, and the split into
 * `footnote_ref` / `inline_footnote` made every one of those stored trees
 * unrenderable - the renderers threw rather than degrading (carve#405).
 */
const legacyTree = (): Document =>
  ({
    type: 'document',
    children: [
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'a' },
          { type: 'footnote', id: 'r' },
          { type: 'text', value: ' ' },
          { type: 'footnote', inline: [{ type: 'text', value: 'n' }] },
        ],
      },
    ],
    footnoteDefs: { r: [{ type: 'paragraph', children: [{ type: 'text', value: 'd' }] }] },
    srcByteLength: 0,
  }) as unknown as Document

describe('a stored 0.1.2 tree still renders', () => {
  it('does not throw on any target', () => {
    for (const render of [renderHtml, renderMarkdown, renderCarve, renderAnsi]) {
      expect(() => render(legacyTree())).not.toThrow()
    }
  })

  it('maps the legacy type by the node its shape identifies', () => {
    // A body means the note was written inline; a label means it points at a
    // definition. That is what the split encodes in the type.
    const carve = renderCarve(legacyTree())

    expect(carve).toContain('[^r]')
    expect(carve).toContain('^[n]')
  })

  it('is input-only: parse never produces the legacy type', () => {
    // The alias must not become a second spelling. Nothing this engine emits
    // carries it.
    expect(JSON.stringify(renderCarve(legacyTree()))).not.toContain('"footnote"')
  })
})
