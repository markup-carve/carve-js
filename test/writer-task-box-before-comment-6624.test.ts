import { describe, expect, it } from 'vitest'
import { type DocumentNode, format, parse } from '../src/index.ts'

function withoutPositions(document: DocumentNode): string {
  return JSON.stringify(document.children, (key, value: unknown) => (key === 'pos' ? undefined : value))
}

describe('carve#6624: a text bracket before a line comment at the start of an item', () => {
  for (const [source, expected] of [
    ['-  [x] %%\n', '- \\[x] %%\n'],
    ['-  [ ] %% c\n', '- \\[ ] %% c\n'],
    ['1.  [X]\t%%\n', '1. \\[X] %%\n'],
  ] as const) {
    it(`C2-W-002: ${JSON.stringify(source)} keeps [x] as text`, () => {
      expect(format(source)).toBe(expected)
      expect(withoutPositions(parse(format(source)))).toBe(withoutPositions(parse(source)))
    })
  }

  it('C2-W-002, C2-B-084: text *[K]: before a line comment stays text', () => {
    const source = '\\*[HTML]: %%\n'
    expect(withoutPositions(parse(format(source)))).toBe(withoutPositions(parse(source)))
  })
})
