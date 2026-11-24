import { describe, expect, it } from 'vitest'
import { type DocumentNode, format, parse } from '../src/index.ts'

function linesAndColumns(document: DocumentNode): string {
  return JSON.stringify(document.children, (key, value: { startLine: number, startColumn: number, endLine: number, endColumn: number }) =>
    key === 'pos' ? [value.startLine, value.startColumn, value.endLine, value.endColumn] : value)
}

describe('carve#6595: a row-end line comment before a + row in CRLF input', () => {
  for (const source of ['| a | %% x\n+ b |\n', '| a | %%\n+ b |\n', '| a |{.r} %% x\n+ b |\n+ c |\n', '> | a | %% x\n> + b |\n']) {
    it(`C2-B-010, C2-A-151: ${JSON.stringify(source)} reads the same with CRLF endings`, () => {
      const crlf = source.replace(/\n/g, '\r\n')
      expect(linesAndColumns(parse(crlf))).toBe(linesAndColumns(parse(source)))
      expect(format(crlf)).toBe(format(source))
    })
  }

  it('keeps no CR in the comment value or its span', () => {
    const table = parse('| a | %% x\r\n+ b |\r\n').children[0] as unknown as { children: [{ children: unknown[] }] }
    expect(table.children[0].children[1]).toMatchObject({ type: 'comment', form: 'line', value: 'x', pos: { startOffset: 5, endOffset: 10 } })
    expect(format('| a | %% x\r\n+ b |\r\n')).toBe('| a |\n+ b |\n%% x\n+ |\n')
  })
})
