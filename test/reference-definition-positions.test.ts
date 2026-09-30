import { describe, expect, it } from 'vitest'
import { parse } from '../src/index.js'
import { definitionLinePosition } from '../src/source-positions.js'

describe('reference definition positions', () => {
  for (const ending of ['\n', '\r\n', '\r']) {
    it(`selects definitions after ${JSON.stringify(ending)} line endings`, () => {
      const source = ['prose', '', '[a]: /first', '[b]: /second', '', '[x][b]'].join(ending)
      const definitions = parse(source).children.filter((node) => node.type === 'link_reference_definition')
      expect(definitions).toHaveLength(2)
      for (const definition of definitions) {
        expect(source.slice(definition.pos!.startOffset, definition.pos!.endOffset))
          .toBe(`[${definition.label}]: ${definition.href}`)
      }
    })
  }

  it('keeps codepoint offsets after a BOM and astral text', () => {
    const source = '\ufeff😀 prose\r\n\r\n[a]: /first\r\n[b]: /second'
    const points = Array.from(source)
    for (const definition of parse(source).children.filter((node) => node.type === 'link_reference_definition')) {
      expect(points.slice(definition.pos!.startOffset, definition.pos!.endOffset).join(''))
        .toBe(`[${definition.label}]: ${definition.href}`)
    }
  })

  it('starts a first-line definition after the BOM', () => {
    const source = '\ufeff[a]: /first'
    const definition = parse(source).children.find((node) => node.type === 'link_reference_definition')!
    expect(definition.pos).toMatchObject({ startOffset: 1, endOffset: source.length, startColumn: 2 })
    expect(source.slice(definition.pos!.startOffset, definition.pos!.endOffset)).toBe('[a]: /first')
  })

  it('reads only the indexed line for each definition', () => {
    let reads = 0
    const observed = <T>(values: T[]): T[] => new Proxy(values, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++
        return Reflect.get(target, key, receiver) as unknown
      },
    })
    const count = 4096
    const lines = observed(Array.from({ length: count }, (_, i) => `[r${i}]: /target`))
    const starts = observed(Array.from({ length: count }, (_, i) => i * 20))
    for (let line = 0; line < count; line++) definitionLinePosition(lines, starts, line, count * 20)
    expect(reads).toBe(count * 2)
  })
})
