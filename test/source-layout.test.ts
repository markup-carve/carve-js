import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse, parseWithSourceLayout, toAstJson } from '../src/index.js'

const fixtures = JSON.parse(readFileSync(new URL('../spec/resources/ast-source-layout-fixtures.json', import.meta.url), 'utf8'))

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

  it('matches the shared cross-engine fixtures', () => {
    for (const fixture of fixtures.exact) {
      expect(parseWithSourceLayout(fixture.source).layout, fixture.name).toEqual(fixture.layout)
    }
    for (const fixture of fixtures.sourceFacts) {
      const layout = parseWithSourceLayout(fixture.source).layout
      expect(layout, fixture.name).toMatchObject({
        version: 1, encoding: 'utf-8', source: fixture.source,
        lineEndings: fixture.lineEndings, bom: fixture.bom,
      })
      expect(layout.nodes.every((node) => node.startByte <= node.endByte), fixture.name).toBe(true)
    }
  })
})
