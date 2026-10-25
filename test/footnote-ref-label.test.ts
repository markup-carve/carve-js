import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml, fromAstJson, toAstJson } from '../src/index.js'

const refOf = (source: string) => {
  const tree = carveToAstJson(source) as unknown as {
    children: Array<{ children?: Array<Record<string, unknown>> }>
  }
  return tree.children[0]!.children!.find((n) => n['type'] === 'footnote_ref')!
}

describe('a footnote reference uses the 2.0 reference key', () => {
  it('publishes the key and footnote namespace', () => {
    const ref = refOf('a[^1]\n\n[^1]: n\n')
    expect(ref['key']).toBe('1')
    expect(ref['namespace']).toBe('footnote')
    expect(ref['id']).toBeUndefined()
  })

  it('keeps the resolution result beside it', () => {
    expect(refOf('a[^1]\n\n[^1]: n\n')['number']).toBe(1)
  })

  it('refuses the legacy `id` spelling rather than aliasing it', () => {
    // §11's narrow exception is a MAY. This engine already refuses
    // `footnote.id` on the definition half of the same pair (carve#743), and
    // tolerating the old spelling on one half only is two ways to say one thing.
    expect(() =>
      fromAstJson({
        type: 'document',
        astVersion: '2.0',
        stages: ['blockImagePromotion', 'referenceResolution', 'tableAlignment'],
        srcByteLength: 1,
        children: [{ type: 'paragraph', children: [{ type: 'footnote_ref', id: '1' }] }],
      } as never),
    ).toThrow(/"id", which the schema does not name/)
  })

  it('round-trips through its own ingest', () => {
    const tree = carveToAstJson('a[^1]\n\n[^1]: n\n')
    const again = toAstJson(fromAstJson(JSON.parse(JSON.stringify(tree)))) as unknown as {
      children: Array<{ children?: Array<Record<string, unknown>> }>
    }
    const ref = again.children[0]!.children!.find((n) => n['type'] === 'footnote_ref')!
    expect(ref['key']).toBe('1')
    expect(ref['namespace']).toBe('footnote')
  })

  it('leaves rendered output alone', () => {
    expect(carveToHtml('a[^1]\n\n[^1]: n\n')).toContain('href="#fn1"')
  })
})
