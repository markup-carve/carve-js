import { describe, expect, it } from 'vitest'
import { parse, parseWithSourceLayout, toAstJson } from '../src/index.js'

describe('source layout sidecar', () => {
  it('is opt-in and uses original UTF-8 byte offsets', () => {
    const source = '\uFEFF- 😀\r\n'
    const plain = toAstJson(parse(source))
    expect(plain).not.toHaveProperty('sourceLayout')
    const { ast, layout } = parseWithSourceLayout(source)
    expect(ast).toEqual(plain)
    expect(layout).toMatchObject({ version: 1, encoding: 'utf-8', source, lineEndings: 'crlf', bom: true })
    expect(layout.nodes.every((node) => node.startByte <= node.endByte)).toBe(true)
    expect(layout.nodes.every((node) => node.endByte <= new TextEncoder().encode(source).length)).toBe(true)
  })
})
