import { describe, expect, it } from 'vitest'
import { formatWithDiagnostics, parse, writeWithDiagnostics } from '../src/index.ts'
import { treesEqual } from '../src/ast-json.ts'
import type { TableNode } from '../src/ast.ts'

describe('carve#6860, carve#6874: header-rows ends the head the written rows and keys would not, and a kept body key makes none', () => {
  it.each([
    ['{header-rows=0 body-rows}\n|= a |\n', '{body-rows header-rows=0}\n|= a |\n'],
    ['{header-rows=1 footer-rows=1 body-rows=0}\n|= a |\n|= b |\n', '{header-rows=1 footer-rows=1 body-rows=0}\n|= a |\n|= b |\n'],
    ['{header-rows=0 body-header-rows=1}\n|= h |\n', '{body-header-rows=1 header-rows=0}\n|= h |\n'],
    ['{header-rows=0 body-header-cols=1}\n|= h |\n', '{body-header-cols=1 header-rows=0}\n|= h |\n'],
    ['{header-rows=1 body-rows=x}\n|= h |\n|= a |\n| 1 |\n', '{body-rows=x header-rows=1}\n|= h |\n|= a |\n| 1 |\n'],
    ['{footer-rows=1 body-rows}\n|= A |\n|= ^ |\n|= F |\n', '{footer-rows=1 body-rows}\n|= A |\n|= ^ |\n|= F |\n'],
    ['{header-rows=1 footer-rows=1 body-rows="\u00a0"}\n|= a |\n|= b |\n', '{body-rows=\u00a0 header-rows=1 footer-rows=1}\n|= a |\n|= b |\n'],
    ['- {header-rows=0 body-header-rows=1}\n  |= h |\n', '- {body-header-rows=1 header-rows=0}\n  |= h |\n'],
  ])('writes %j as %j with no report, and it reads back', (source, expected) => {
    const written = formatWithDiagnostics(source)
    expect(written.source).toBe(expected)
    expect(written.diagnostics).toEqual([])
    expect(treesEqual(parse(written.source), parse(source))).toBe(true)
  })

  it('reports a kept body key beside bodies that need made body keys, and writes the bodies from the fields', () => {
    const tree = parse('{.c k=v body-rows=1,1}\n| a |\n| b |\n', { positions: false })
    const table = tree.children[0] as TableNode
    table.attrs!.keyValues!.push(['body-header-cols', 'x'])
    const written = writeWithDiagnostics(tree)
    expect(written.source).toBe('{.c k=v body-rows=1,1}\n| a |\n| b |\n')
    expect(written.diagnostics.map((entry) => entry.code)).toEqual(['field-unspellable'])
  })
})
