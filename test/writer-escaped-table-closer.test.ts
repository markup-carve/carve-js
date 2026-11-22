import { describe, expect, it } from 'vitest'
import { parse, treesEqual, writeWithDiagnostics, type DocumentNode, type Inline } from '../src/index.ts'

function document(children: Inline[]): DocumentNode {
  return { type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children }] }
}

function check(children: Inline[], source: string): void {
  const tree = document(children)
  const result = writeWithDiagnostics(tree)
  expect(result).toEqual({ source, diagnostics: [] })
  expect(treesEqual(parse(source), tree)).toBe(true)
}

describe('writer table closer repair', () => {
  it('escapes a closing pipe after a multiline code span', () => {
    check([{ type: 'text', value: 'a ' }, { type: 'code', value: 'x\n|' }, { type: 'text', value: ' |' }], 'a `x\n|` \\|\n')
  })

  it('escapes a closing pipe after a code and math span', () => {
    check([{ type: 'text', value: 'a ' }, { type: 'code', value: 'x\n|' },
      { type: 'math', display: false, value: 'y' }, { type: 'text', value: '|' }], 'a `x\n|`$`y`\\|\n')
  })
})
