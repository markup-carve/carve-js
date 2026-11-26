// C2-B-029, C2-B-007, C2-B-123 (carve#6465): a comment block in a line block is stripped by at most its opener's indent.
import { describe, expect, it } from 'vitest'
import { format, parse } from '../src/index.ts'

function commentValue(src: string): string | undefined {
  const find = (node: { type: string, form?: string, value?: string, children?: unknown[] }): string | undefined =>
    node.type === 'comment' && node.form === 'block' ? node.value : (node.children ?? []).map((child) => find(child as never)).find((v) => v !== undefined)
  return find(parse(src) as never)
}

describe('a comment block in a line block', () => {
  it.each([
    ['::: |\n  %%%\n  c\n  %%%\n:::\n', 'c'],
    ['- ::: |\n\t%%%\n\tc\td\n\t%%%\n', 'c\td'],
    ['::: |\n  %%%\n    c\n d\n  %%%\n:::\n', '  c\nd'],
    ['> ::: |\n>   %%%\n>     x\n>   %%%\n> :::\n', '  x'],
    ['::: |\n\t%%%\n  \tc\n\t%%%\n:::\n', 'c'],
    ['::: |\n %%%\n\tc\n %%%\n:::\n', '\tc'],
    ['::: |\n  %%%\n\n  c\n  %%%\n:::\n', '\nc'],
  ])('%j gives %j', (src, value) => {
    expect(commentValue(src)).toBe(value)
    expect(commentValue(format(src))).toBe(value)
  })

  it('in a div the strip is the same', () => {
    expect(commentValue('- :::\n\t%%%\n\tc\td\n\t%%%\n')).toBe(commentValue('- ::: |\n\t%%%\n\tc\td\n\t%%%\n'))
  })
})
