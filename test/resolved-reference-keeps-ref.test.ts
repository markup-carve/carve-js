import { describe, it, expect } from 'vitest'
import { parse, resolve, toAstJson } from '../src/index.js'
import type { Link, Paragraph } from '../src/ast.js'

/*
 * PART 12 §3a, A RESOLVED REFERENCE KEEPS ITS DESTINATION:
 *
 *   {"type":"link","href":"/start","ref":"getting started",
 *    "rawRef":"[getting started][]"}
 *
 * The authored construct survives beside the resolution result, exactly as §5
 * already has footnote numbering added alongside rather than in place of the
 * reference. The distinction the clause protects - `[a][]` against `[a](#a)` -
 * is carried by `ref` and `rawRef`, and dropping them makes the two
 * indistinguishable in the tree.
 *
 * The clause names all three engines as missing this half (carve#589's
 * neighbourhood; the rule was written against measurements of every one).
 */
const linkOf = (source: string): Link => {
  const doc = resolve(parse(source))
  const para = doc.children.find((n) => n.type === 'paragraph') as Paragraph
  const link = para.children.find((n) => n.type === 'link') as Link
  expect(link).toBeDefined()
  return link
}

describe('a resolved reference link', () => {
  it('keeps ref and rawRef beside the destination', () => {
    const link = linkOf('see [t][r].\n\n[r]: /u\n')
    expect(link.href).toBe('/u')
    expect(link.ref).toBe('r')
    expect(link.rawRef).toBe('[t][r]')
  })

  it('keeps them for the collapsed form too', () => {
    const link = linkOf('see [r][].\n\n[r]: /u\n')
    expect(link.href).toBe('/u')
    expect(link.ref).toBe('r')
    expect(link.rawRef).toBe('[r][]')
  })

  it('keeps them for an implicit heading reference', () => {
    const link = linkOf('# H\n\nSee [H][].\n')
    expect(link.href).toBe('#H')
    expect(link.ref).toBe('H')
    expect(link.rawRef).toBe('[H][]')
  })

  it('publishes them on the wire', () => {
    const json = JSON.parse(JSON.stringify(toAstJson(resolve(parse('see [t][r].\n\n[r]: /u\n')))))
    const found: Array<Record<string, unknown>> = []
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) return n.forEach(walk)
      if (n && typeof n === 'object') {
        const node = n as Record<string, unknown>
        if (node.type === 'link') found.push(node)
        Object.values(node).forEach(walk)
      }
    }
    walk(json)
    expect(found).toHaveLength(1)
    expect(found[0]!.ref).toBe('r')
    expect(found[0]!.rawRef).toBe('[t][r]')
    expect(found[0]!.href).toBe('/u')
  })

  it('leaves an inline link with no ref at all', () => {
    const link = linkOf('see [t](/u).\n')
    expect(link.href).toBe('/u')
    expect(link.ref).toBeUndefined()
    expect(link.rawRef).toBeUndefined()
  })

  it('still renders as a link', () => {
    expect(linkOf('see [t][r].\n\n[r]: /u\n').children).toHaveLength(1)
  })
})
