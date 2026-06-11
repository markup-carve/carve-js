import { describe, expect, it } from 'vitest'

import { parse } from '../src/index.js'
import { citations } from '../src/citations.js'

function group(src: string): { items: { key: string; suppressAuthor: boolean }[] } | undefined {
  const doc = parse(src, { extensions: [citations()] })
  const p = doc.children.find((b) => b.type === 'paragraph') as
    | { children: { type: string }[] }
    | undefined
  return p?.children.find((n) => n.type === 'citation-group') as never
}

describe('citation matcher', () => {
  it('parses [@key] into a citation-group', () => {
    expect(group('[@smith2020]')?.items[0]!.key).toBe('smith2020')
  })

  it('leaves a bare @mention alone', () => {
    const doc = parse('@alice', { extensions: [citations()] })
    const p = doc.children[0] as { children: { type: string }[] }
    expect(p.children[0]!.type).toBe('mention')
  })

  it('does not claim a reference link [text][ref]', () => {
    expect(group('[text][ref]')).toBeUndefined()
  })

  it('declines a plain bracket with no @key', () => {
    expect(group('[just text]')).toBeUndefined()
  })

  it('parses a locator', () => {
    const g = parse('[@smith2020, p. 33]', { extensions: [citations()] })
    const p = g.children[0] as { children: { type: string; locator?: unknown[] }[] }
    const cg = p.children.find((n) => n.type === 'citation-group') as never as {
      items: { key: string; locator?: unknown[] }[]
    }
    expect(cg.items[0]!.key).toBe('smith2020')
    expect(cg.items[0]!.locator).toBeDefined()
  })

  it('parses suppress-author -@key', () => {
    expect(group('[-@smith2020]')?.items[0]!.suppressAuthor).toBe(true)
  })

  it('parses multiple ;-separated items', () => {
    const g = group('[@a; @b]')
    expect(g?.items.map((i) => i.key)).toEqual(['a', 'b'])
  })
})
