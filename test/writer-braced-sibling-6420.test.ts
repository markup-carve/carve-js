// carve#6420, C2-W-069: a same-kind span after a braced sibling is braced only where its own bare mark fails there.
import { describe, expect, it } from 'vitest'
import { type DocumentNode, type Inline, parse, treesEqual, write } from '../src/index.ts'

function para(...children: Inline[]): DocumentNode {
  return { type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children }] } as DocumentNode
}

function span(type: 'emphasis' | 'strong', value: string): Inline {
  return { type, children: [{ type: 'text', value }] } as Inline
}

describe('carve#6420: a same-kind span after a braced sibling', () => {
  const cases: [string, DocumentNode, string][] = [
    ['leading space', para(span('emphasis', ' a'), span('emphasis', 'a')), '{/ a/}/a/\n'],
    ['strong', para(span('strong', ' b'), span('strong', 'a')), '{* b*}*a*\n'],
    ['trailing space', para(span('emphasis', 'a '), span('emphasis', 'a')), '{/a /}/a/\n'],
    ['three siblings', para(span('emphasis', ' a'), span('emphasis', 'b'), span('emphasis', 'c')), '{/ a/}/b/{/c/}\n'],
    ['strong after strong, inner space', para(span('strong', ' a '), span('strong', 'b c')), '{* a *}*b c*\n'],
    ['bare pair glues', para(span('emphasis', 'a'), span('emphasis', 'b')), '/a/{/b/}\n'],
  ]
  for (const [name, tree, expected] of cases) {
    it(name, () => {
      const source = write(tree)
      expect(source).toBe(expected)
      expect(treesEqual(parse(source), tree)).toBe(true)
    })
  }
})
