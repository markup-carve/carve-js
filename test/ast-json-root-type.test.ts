import { describe, it, expect } from 'vitest'
import { AstJsonRootError, fromAstJson } from '../src/index.js'

/*
 * The root type is not a leniency point (PART 12 §9, closing paragraph):
 *
 *   "§7 fixes it at `document`, and the schema pins it as a `const`. An ingest
 *    accepting some other root (`doc`, say, which is ProseMirror's) will
 *    half-read a foreign format rather than reject it."
 *
 * This engine accepted `doc` - ProseMirror's root, the clause's own example -
 * and then wrote `type: 'document'` into the tree it returned, so the evidence
 * that the input was a foreign format was normalized away before any caller
 * could see it. carve-rs and carve-php both reject it.
 */
describe('fromAstJson checks the root type', () => {
  const para = {
    type: 'paragraph',
    pos: { startLine: 1, endLine: 1, startColumn: 1, endColumn: 2, startOffset: 0, endOffset: 1 },
    children: [],
  }

  it('accepts a document root', () => {
    const doc = fromAstJson({ type: 'document', children: [para], srcByteLength: 1 } as never)
    expect(doc.type).toBe('document')
    expect(doc.children).toHaveLength(1)
  })

  it("rejects ProseMirror's doc root", () => {
    expect(() => fromAstJson({ type: 'doc', children: [para], srcByteLength: 1 } as never)).toThrow(
      AstJsonRootError,
    )
  })

  it('names both the type it found and the one it requires', () => {
    let message = ''
    try {
      fromAstJson({ type: 'doc', children: [para], srcByteLength: 1 } as never)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('doc')
    expect(message).toContain('document')
  })

  it('rejects a missing root type rather than assuming one', () => {
    expect(() => fromAstJson({ children: [para], srcByteLength: 1 } as never)).toThrow(
      AstJsonRootError,
    )
  })
})
