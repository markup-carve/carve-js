import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'

describe('next2 writer and extension reference regressions', () => {
  it.each([
    ['/{>\\/a/}', '{/{>/a/}}'],
    ['*{>\\*a*}', '{*{>*a*}}'],
    ['x *\\\na* y', 'x *\\\na* y'],
    ['/\\\na/', '/\\\na/'],
    ['\\{-"-}', '\\{-"-}'],
    ["\\{+'+}", "\\{+'+}"],
  ])('writes %j as %j and reads it back', (input, expected) => {
    const output = format(input)
    expect(output).toBe(`${expected}\n`)
    expect(treesEqual(parse(output), parse(input))).toBe(true)
  })

  it.each([
    [':n[[a]]\n\n[a]: /', 'link', 'href', '/'],
    [':n[[x][a]]\n\n[a]: /', 'link', 'href', '/'],
    [':n[![a]]\n\n[a]: /i', 'image', 'src', '/i'],
  ])('resolves a %s reference in an extension', (input, type, field, target) => {
    const extension = parse(input).children[0]
    expect(extension?.type).toBe('paragraph')
    if (extension?.type !== 'paragraph') return
    const inner = extension.children[0]
    expect(inner?.type).toBe('inline_extension')
    if (inner?.type !== 'inline_extension') return
    const reference = inner.children[0]
    expect(reference?.type).toBe(type)
    expect((reference as unknown as Record<string, unknown>)[field]).toBe(target)
  })
})
