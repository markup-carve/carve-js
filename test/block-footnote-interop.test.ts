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
        { type: 'footnote', label: 'r', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'def' }] }] },
      ],
      srcByteLength: 0,
    }) as unknown as Document

  it('renders instead of throwing', () => {
    expect(() => renderHtml(phpShaped())).not.toThrow()
  })

  it('matches what this engine renders from equivalent source', () => {
    expect(renderHtml(phpShaped()).trim()).toBe(carveToHtml('a[^r]\n\n[^r]: def\n').trim())
  })

  it('reads `label`, and only `label`', () => {
    // `id` was the spelling before PART 12 §7 settled it, and this reader took
    // both. The decoder now refuses `id` (carve-js#907), and this reader goes
    // with it so the engine gives ONE answer about the field rather than
    // refusing a payload it would have rendered had the caller decoded it
    // themselves. A definition with no label is dropped like any other
    // malformed one and its reference renders unresolved, which is what a
    // missing definition already means - it must not throw.
    const idShaped = JSON.parse(JSON.stringify(phpShaped()))
    idShaped.children[1].label = undefined
    delete idShaped.children[1].label
    idShaped.children[1].id = 'r'
    expect(() => renderHtml(idShaped)).not.toThrow()
    expect(renderHtml(idShaped)).not.toContain('doc-endnotes')
  })

  it('leaves a tree without block definitions alone', () => {
    // The hoist must be a no-op for this engine's own output.
    const own = parse('a[^r]\n\n[^r]: def\n')
    expect(renderHtml(own)).toBe(carveToHtml('a[^r]\n\n[^r]: def\n'))
  })
})
