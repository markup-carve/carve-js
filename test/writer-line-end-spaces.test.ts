// C2-W-151 (carve#6319): spaces and tabs that would end a source line in text are dropped without a report.
import { describe, expect, it } from 'vitest'
import { type Block, type DocumentNode, type Inline } from '../src/ast.ts'
import { writeWithDiagnostics } from '../src/index.ts'
import { growthRatio } from './support/growth.ts'

const text = (value: string): Inline => ({ type: 'text', value })
const SOFT: Inline = { type: 'soft_break' }
const documentOf = (...children: Block[]): DocumentNode => ({ type: 'document', astVersion: '2.0', children })
const paragraph = (...children: Inline[]): Block => ({ type: 'paragraph', children })
const reports = (document: DocumentNode): string[] =>
  writeWithDiagnostics(document).diagnostics.map((entry) => `${entry.code} ${entry.path ?? ''}`)

describe('C2-W-151: line-end spaces and tabs of text', () => {
  const quiet: [string, DocumentNode, string][] = [
    ['A: one text', documentOf(paragraph(text('x '))), 'x\n'],
    ['B: text after an emphasis', documentOf(paragraph(text('a '), { type: 'emphasis', children: [text('b')] }, text(' c '))), 'a /b/ c\n'],
    ['C: a space and a tab before a soft break', documentOf(paragraph(text('a \t'), SOFT, text('b'))), 'a\nb\n'],
    ['D: text after a multi-line code span', documentOf(paragraph(text('a '), { type: 'code', value: 'x\n|' }, text('|a '))), 'a `x\n|`|a\n'],
    ['a text of only spaces at the end', documentOf(paragraph(text('a'), text('  '))), 'a\n'],
    ['a heading', documentOf({ type: 'heading', level: 1, children: [text('T ')] }), '= T\n'],
    ['a line of a line block', documentOf({ type: 'line_block', children: [{ type: 'line', children: [text('x ')] }, { type: 'line', children: [text('y')] }] }), '::: |\nx\ny\n:::\n'],
    ['text in an emphasis before a soft break', documentOf(paragraph({ type: 'emphasis', children: [text('b '), SOFT, text('c')] })), '/b\nc/\n'],
  ]
  it.each(quiet)('%s', (_, document, source) => {
    const before = JSON.stringify(document)
    const output = writeWithDiagnostics(document)
    expect(output.source).toBe(source)
    expect(output.diagnostics).toEqual([])
    expect(JSON.stringify(document), 'the supplied tree is not changed').toBe(before)
  })

  it('keeps a trailing space of a cell that a delimited table writes as data', () => {
    const cell = (value: string): never => ({ type: 'table_cell', header: false, children: [{ type: 'cell_paragraph', children: [text(value)] }] }) as never
    const table: Block = {
      type: 'table', columns: [{ type: 'table_column' }],
      children: [{ type: 'table_body', children: [{ type: 'table_row', children: [cell('x ')] }] }],
    } as Block
    const output = writeWithDiagnostics(documentOf(table))
    expect(output.source).toBe('{table header-rows=0}\n```csv\nx \n```\n')
    expect(output.diagnostics).toEqual([])
    const captioned = { ...table, caption: { type: 'caption', children: [paragraph(text('cap '))] } } as Block
    const withCaption = writeWithDiagnostics(documentOf(captioned))
    expect(withCaption.source, 'the caption of a delimited table is trimmed').toBe('{table header-rows=0}\n```csv\nx \n```\n^ cap\n')
    expect(withCaption.diagnostics).toEqual([])
  })

  it('keeps the cells of a table that trimming would turn delimited', () => {
    const cell = (...children: Inline[]): never => ({ type: 'table_cell', header: false, children: [{ type: 'cell_paragraph', children }] }) as never
    const table: Block = {
      type: 'table', columns: [{ type: 'table_column' }, { type: 'table_column' }],
      children: [{ type: 'table_body', children: [{ type: 'table_row', children: [cell(text('a'), text(' ')), cell(text(' b'))] }] }],
    } as Block
    const output = writeWithDiagnostics(documentOf(table))
    expect(output.source).toBe('| a  |  b |\n')
    expect(output.diagnostics.map((entry) => entry.code)).toEqual(['structure-unspellable', 'field-unspellable'])
  })

  it('still reports an attributed text whose attribute block follows its spaces', () => {
    const attributed = (value: string): Inline => ({ type: 'text', value, attrs: { classes: ['c'] } }) as Inline
    expect(reports(documentOf(paragraph(text('a'), attributed('x '))))).toEqual(['structure-unspellable /children/0'])
    expect(reports(documentOf(paragraph(text('a'), attributed('  '))))).toEqual(['structure-unspellable /children/0'])
  })

  it('still reports a code span whose value loses a space before its line break', () => {
    expect(reports(documentOf(paragraph(text('a'), { type: 'code', value: 'x \ny' })))).toEqual(['field-unspellable /children/0/children/1/value'])
  })

  it('still reports a leading space after a soft break, at its own node', () => {
    expect(reports(documentOf(paragraph(text('a '), SOFT, text(' b'))))).toEqual(['field-unspellable /children/0/children/2/value'])
  })

  it('still reports a line of only spaces, which splits the paragraph', () => {
    expect(reports(documentOf(paragraph(text('a'), SOFT, text('  '), SOFT, text('b')))).map((entry) => entry.split(' ')[0])).toContain('structure-unspellable')
  })

  it('takes time linear in the lines', () => {
    const lines = (count: number): DocumentNode => documentOf(paragraph(...Array.from({ length: count }, (_, i): Inline[] => [text(`w${i} `), SOFT]).flat(), text('end ')))
    const small = lines(500)
    const large = lines(8000)
    const { ratio, times } = growthRatio(() => writeWithDiagnostics(small), () => writeWithDiagnostics(large))
    expect(ratio, `${times.map((time) => time.toFixed(1)).join(', ')} ms`).toBeLessThan(48)
  })

  it('takes time linear in the lines when each line ends in a text of only spaces', () => {
    const lines = (count: number): DocumentNode => documentOf(paragraph(...Array.from({ length: count }, (_, i): Inline[] => [text(`w${i}`), text(' '), SOFT]).flat(), text('end')))
    const small = lines(500)
    const large = lines(8000)
    const { ratio, times } = growthRatio(() => writeWithDiagnostics(small), () => writeWithDiagnostics(large))
    expect(ratio, `${times.map((time) => time.toFixed(1)).join(', ')} ms`).toBeLessThan(48)
  })

  it('gives back a tree whose dropped texts were spread over several lists', () => {
    const document = documentOf(
      paragraph(text('a'), text(' '), SOFT, { type: 'emphasis', children: [text('b'), text('\t'), SOFT, text('c')] }, text(' '), SOFT, text('d')),
      { type: 'heading', level: 1, children: [text('T'), text('  ')] },
    )
    const before = JSON.stringify(document)
    const output = writeWithDiagnostics(document)
    expect(output.source).toBe('a\n/b\nc/\nd\n\n= T\n')
    expect(output.diagnostics).toEqual([])
    expect(JSON.stringify(document)).toBe(before)
  })
})
