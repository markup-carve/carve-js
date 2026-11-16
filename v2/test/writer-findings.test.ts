// Writer defects of the engine TODO list, each fixed at its clause.
import { describe, expect, it } from 'vitest'
import { decodeTree, format, writeWithDiagnostics } from '../src/index.ts'
import { checkWriter } from './support/writer-checks.ts'

const comment = { type: 'comment', form: 'line', value: 'x \t ' }
const cell = { type: 'table_cell', header: false, children: [{ type: 'cell_paragraph', children: [{ type: 'text', value: 'a' }] }] }

function written(children: unknown[]): { source: string, codes: string[] } {
  const output = writeWithDiagnostics(decodeTree(JSON.stringify({ type: 'document', astVersion: '2.0', children })))
  return { source: output.source, codes: output.diagnostics.map((entry) => `${entry.code} ${entry.path ?? ''}`) }
}

describe('line comments', () => {
  it('C2-W-022, C2-W-117: a line comment value that ends with spaces or tabs is written without them, and the loss is reported', () => {
    expect(written([comment])).toEqual({ source: '%% x\n', codes: ['field-unspellable /children/0'] })
    expect(written([{ type: 'comment', form: 'line', value: '  ' }])).toEqual({ source: '%%\n', codes: ['field-unspellable /children/0'] })
  })

  it('C2-W-022, C2-W-117: so is the value of an inline line comment and of a comment between table rows', () => {
    expect(written([{ type: 'paragraph', children: [{ type: 'text', value: 'a' }, comment] }]))
      .toEqual({ source: 'a %% x\n', codes: ['field-unspellable /children/0/children/1'] })
    const table = written([{ type: 'table', columns: [{ type: 'table_column' }],
      children: [{ type: 'table_body', children: [{ type: 'table_row', children: [cell] }, comment] }] }])
    expect(table.source.split('\n').every((line) => !line.endsWith(' ') && !line.endsWith('\t'))).toBe(true)
    expect(table.codes).toEqual(['field-unspellable /children/0/children/0/children/1'])
  })
})

describe('the slow reference of the escapes', () => {
  it('C2-W-125: where no case gives the tree alone, the backslash of case six is kept and the brace stays bare', () => {
    for (const mark of ['.c}', '', '*', '/', '-', '=', '%', '#']) {
      const source = `x{${mark}\\\`\`a\`\\\``
      expect(checkWriter(source), source).toBeNull()
      expect(format(source)).toBe(`${source}\n`)
    }
  })
})

describe('the four-token gate', () => {
  it('C2-W-088, C2-W-125: where one backslash gives the tree alone, case six adds none behind it', () => {
    const slash = String.fromCharCode(92)
    const tick = String.fromCharCode(96)
    const inputs = [`x(/u)${slash}//}/`, `x(/u)${slash}//}/}`, `x${slash}${tick}${tick}a${tick}{.c}}`]
    for (const source of inputs) {
      expect(checkWriter(source), source).toBeNull()
      expect(format(source)).toBe(`${source}\n`)
    }
  })
})
