import { describe, it, expect } from 'vitest'
import { parse, resolve as resolveDoc, renderHtml } from '../src/index.js'
import { toAstJson } from '../src/ast-json.js'
import { carveToAstJson, carveToHtml } from '../src/index.js'

// carve-js#479: PART 12 §5 keeps footnote numbering in a serialized AST,
// same as caption numbers, so a consumer never has to reimplement PART 9R
// (document reference order, first definition wins, unreferenced definitions
// dropped, repeated references sharing a number with distinct backlinks).

describe('footnote numbering is a resolution result (carve-js#479)', () => {
  it('numbers two distinct labels in reference order', () => {
    const json = carveToAstJson('P[^a] and [^b].\n\n[^a]: note a\n\n[^b]: note b\n')
    const para = json.children[0] as { children: Array<{ type: string; id?: string; number?: number }> }
    const refs = para.children.filter((n) => n.type === 'footnote_ref')
    expect(refs.map((r) => [r.id, r.number])).toEqual([
      ['a', 1],
      ['b', 2],
    ])
  })

  it('a repeated reference shares the first occurrence\'s number', () => {
    const json = carveToAstJson('P[^a] and [^b] and [^a] again.\n\n[^a]: note a\n\n[^b]: note b\n')
    const para = json.children[0] as { children: Array<{ type: string; id?: string; number?: number }> }
    const refs = para.children.filter((n) => n.type === 'footnote_ref')
    expect(refs.map((r) => [r.id, r.number])).toEqual([
      ['a', 1],
      ['b', 2],
      ['a', 1],
    ])
  })

  it('an unreferenced definition contributes no number to anything', () => {
    // Only `a` is referenced; `b` is defined but never used and must not
    // shift `a`'s number or appear as a footnote_ref anywhere.
    const json = carveToAstJson('P[^a].\n\n[^a]: note a\n\n[^b]: note b\n')
    const para = json.children[0] as { children: Array<{ type: string; id?: string; number?: number }> }
    const refs = para.children.filter((n) => n.type === 'footnote_ref')
    expect(refs.map((r) => [r.id, r.number])).toEqual([['a', 1]])
  })

  it('an inline footnote gets a number too', () => {
    const json = carveToAstJson('P[^a] and^[an inline note].\n\n[^a]: note a\n')
    const para = json.children[0] as {
      children: Array<{ type: string; number?: number }>
    }
    const ref = para.children.find((n) => n.type === 'footnote_ref')
    const inline = para.children.find((n) => n.type === 'inline_footnote')
    expect(ref?.number).toBe(1)
    expect(inline?.number).toBe(2)
  })

  it('refId is absent from a parse-only (never-rendered) AST', () => {
    // A backlink anchor is a rendering concern (PART 12 §5's own carve-out):
    // it must not leak into the serialized tree just because `resolve()` now
    // assigns `number`.
    const doc = resolveDoc(parse('P[^a] and [^a] again.\n\n[^a]: note a\n'))
    const json = toAstJson(doc)
    const para = json.children[0] as { children: Array<{ type: string; refId?: string }> }
    const refs = para.children.filter((n) => n.type === 'footnote_ref')
    expect(refs.length).toBe(2)
    for (const r of refs) expect(r.refId).toBeUndefined()
  })

  it('renderHtml without resolve() first produces identical HTML to resolve() then renderHtml()', () => {
    const source =
      'P[^a] and [^b] and [^a] again, plus an inline^[note] too.\n\n' +
      '[^a]: note a\n\n[^b]: note b\n\n[^c]: unreferenced\n'
    const withResolve = renderHtml(resolveDoc(parse(source)))
    const withoutResolve = renderHtml(parse(source))
    expect(withoutResolve).toBe(withResolve)
    // Cross-check against the convenience entry point too.
    expect(carveToHtml(source)).toBe(withResolve)
  })
})
