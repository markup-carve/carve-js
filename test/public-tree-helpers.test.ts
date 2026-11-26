import { describe, expect, it } from 'vitest'
import {
  diffTree, type DocumentNode, flatten, type IncludeResolver, parse, parseWithDiagnostics, SMART_PUNCTUATION, treesEqual, validateTree,
} from '../public/index.ts'

describe('treesEqual (C2-A-161)', () => {
  it('ignores positions and coalesces adjacent text, where diffTree compares the JSON', () => {
    const a = parse('Some /text/.')
    const b = parse('Some /text/.', { positions: false })
    expect(treesEqual(a, b)).toBe(true)
    const joined = parse('ab', { positions: false })
    const split: DocumentNode = { ...joined, children: [{ type: 'paragraph', children: [
      { type: 'text', value: 'a' }, { type: 'text', value: 'b' },
    ] }] }
    expect(treesEqual(split, joined)).toBe(true)
    expect(diffTree(split, joined).length).toBeGreaterThan(0)
    expect(treesEqual(parse('a'), parse('b'))).toBe(false)
  })
})

describe('SMART_PUNCTUATION (C2-A-098)', () => {
  const treeOf = (node: object) => ({ type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children: [node] }] })

  it('lists every kind with the glyph and source a tree reader accepts', () => {
    expect(SMART_PUNCTUATION).toHaveLength(18)
    expect(Object.isFrozen(SMART_PUNCTUATION) && SMART_PUNCTUATION.every((entry) => Object.isFrozen(entry))).toBe(true)
    for (const { kind, glyph, source } of SMART_PUNCTUATION) {
      expect(() => validateTree(treeOf({ type: 'smart_punctuation', kind, glyph, source })), kind).not.toThrow()
      expect(() => validateTree(treeOf({ type: 'smart_punctuation', kind, glyph: `${glyph}x`, source })), kind).toThrow()
    }
    expect(parse('a ... b', { positions: false }).children[0]).toMatchObject({ children: [{}, { kind: 'ellipsis',
      glyph: SMART_PUNCTUATION.find((entry) => entry.kind === 'ellipsis')?.glyph }, {}] })
  })
})

describe('flatten', () => {
  const files: Record<string, string> = {
    'part.crv': '---\nt: 1\n---\nhi\n\n{{ deep.crv }}\n', 'deep.crv': '> deep\n', 'n1.crv': 'a[^n]\n\n[^n]: one\n',
    'n2.crv': 'b[^n]\n\n[^n]: two\n',
  }
  const resolver: IncludeResolver = ({ path }) => Object.hasOwn(files, path) ? { text: files[path]!, id: path } : { error: 'not_found' }
  const flat = (source: string) => flatten(parse(source, { includes: { resolver, file: 'main.crv' } }))

  it('splices expanded includes in place, recursively and inside containers, and drops their frontmatter', () => {
    expect(flat('{{ part.crv }}\n')).toEqual({ source: 'hi\n\n> deep\n', same: true })
    expect(flat('- {{ part.crv }}\n')).toEqual({ source: '- hi\n\n  > deep\n', same: true })
  })

  it('keeps the directive of an include that did not expand', () => {
    expect(flat('{{ part.crv }}\n\n{{ gone.crv }}\n')).toEqual({ source: 'hi\n\n> deep\n\n{{ gone.crv }}\n', same: true })
    expect(flat('> {{ part.crv #nosec }}\n').source).toBe('> {{ part.crv #nosec }}\n')
    expect(parseWithDiagnostics('{{ gone.crv }}\n', { includes: resolver }).diagnostics.map((entry) => entry.code))
      .toEqual(['include-not-found'])
  })

  it('reports a key that two files define (C2-N-054)', () => {
    expect(flat('{{ n1.crv }}\n\n{{ n2.crv }}\n').same).toBe(false)
  })
})
