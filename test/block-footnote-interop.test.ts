import { describe, expect, it } from 'vitest'
import { renderHtml, carveToHtml, parse } from '../src/index.js'
import type { Document } from '../src/ast.js'

/**
 * `footnote` is a BLOCK type in the spec vocabulary, and carve-php puts a
 * definition in the tree as one. This engine keeps definitions in a root-level
 * `footnoteDefs` map, so a carve-php tree threw `unknown block footnote` and
 * could not be rendered at all (carve#408).
 */
describe('a tree carrying block footnote definitions', () => {
  const phpShaped = (): Document =>
    ({
      type: 'document',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: 'a' }, { type: 'footnote_ref', id: 'r' }] },
        { type: 'footnote', id: 'r', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'def' }] }] },
      ],
      srcByteLength: 0,
    }) as unknown as Document

  it('renders instead of throwing', () => {
    expect(() => renderHtml(phpShaped())).not.toThrow()
  })

  it('matches what this engine renders from equivalent source', () => {
    expect(renderHtml(phpShaped()).trim()).toBe(carveToHtml('a[^r]\n\n[^r]: def\n').trim())
  })

  it('leaves a tree without block definitions alone', () => {
    // The hoist must be a no-op for this engine's own output.
    const own = parse('a[^r]\n\n[^r]: def\n')
    expect(renderHtml(own)).toBe(carveToHtml('a[^r]\n\n[^r]: def\n'))
  })
})
