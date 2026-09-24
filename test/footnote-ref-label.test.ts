import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml, fromAstJson, toAstJson } from '../src/index.js'

const refOf = (source: string) => {
  const tree = carveToAstJson(source) as unknown as {
    children: Array<{ children?: Array<Record<string, unknown>> }>
  }
  return tree.children[0]!.children!.find((n) => n['type'] === 'footnote_ref')!
}

describe('PART 12 §25: a footnote reference spells its target `label`', () => {
  it('publishes `label`, the name its definition uses', () => {
    const ref = refOf('a[^1]\n\n[^1]: n\n')
    expect(ref['label']).toBe('1')
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
    expect(ref['label']).toBe('1')
  })

  it('leaves rendered output alone', () => {
    expect(carveToHtml('a[^1]\n\n[^1]: n\n')).toContain('href="#fn1"')
  })
})
